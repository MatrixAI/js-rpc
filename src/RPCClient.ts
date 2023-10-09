import type { WritableStream, ReadableStream } from 'stream/web';
import type { ContextTimedInput } from '@matrixai/contexts';
import type {
  IdGen,
  HandlerType,
  JSONValue,
  JSONRPCRequestMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  MiddlewareFactory,
  MapCallers,
  StreamFactory,
  ClientManifest,
  RPCStream,
  JSONRPCResponseResult,
  ToError,
} from './types';
import { JSONRPCErrorCode } from './errors';
import Logger from '@matrixai/logger';
import { Timer } from '@matrixai/timer';
import * as middleware from './middleware';
import * as errors from './errors';
import * as utils from './utils';

const timerCleanupReasonSymbol = Symbol('timerCleanUpReasonSymbol');

class RPCClient<M extends ClientManifest> {
  protected onTimeoutCallback?: () => void;
  protected idGen: IdGen;
  protected logger: Logger;
  protected streamFactory: StreamFactory;
  protected toError: ToError;
  protected middlewareFactory: MiddlewareFactory<
    Uint8Array,
    JSONRPCRequest,
    JSONRPCResponse,
    Uint8Array
  >;
  protected callerTypes: Record<string, HandlerType>;
  public registerOnTimeoutCallback(callback: () => void) {
    this.onTimeoutCallback = callback;
  }
  // Method proxies
  public readonly streamKeepAliveTimeoutTime: number;
  public readonly methodsProxy = new Proxy(
    {},
    {
      get: (_, method) => {
        if (typeof method === 'symbol') return;
        switch (this.callerTypes[method]) {
          case 'UNARY':
            return (params, ctx) => this.unaryCaller(method, params, ctx);
          case 'SERVER':
            return (params, ctx) =>
              this.serverStreamCaller(method, params, ctx);
          case 'CLIENT':
            return (ctx) => this.clientStreamCaller(method, ctx);
          case 'DUPLEX':
            return (ctx) => this.duplexStreamCaller(method, ctx);
          case 'RAW':
            return (header, ctx) => this.rawStreamCaller(method, header, ctx);
          default:
            return;
        }
      },
    },
  );

  /**
   * @param obj
   * @param obj.manifest - Client manifest that defines the types for the rpc
   * methods.
   * @param obj.streamFactory - An arrow function that when called, creates a
   * new stream for each rpc method call.
   * @param obj.middlewareFactory - Middleware used to process the rpc messages.
   * The middlewareFactory needs to be a function that creates a pair of
   * transform streams that convert `JSONRPCRequest` to `Uint8Array` on the forward
   * path and `Uint8Array` to `JSONRPCResponse` on the reverse path.
   * @param obj.streamKeepAliveTimeoutTime - Timeout time used if no timeout timer was provided when making a call.
   * Defaults to 60,000 milliseconds.
   * for a client call.
   * @param obj.logger
   */
  public constructor({
    manifest,
    streamFactory,
    middlewareFactory = middleware.defaultClientMiddlewareWrapper(),
    streamKeepAliveTimeoutTime = Infinity,
    logger,
    toError = utils.toError,
    idGen = () => Promise.resolve(null),
  }: {
    manifest: M;
    streamFactory: StreamFactory;
    middlewareFactory?: MiddlewareFactory<
      Uint8Array,
      JSONRPCRequest,
      JSONRPCResponse,
      Uint8Array
    >;
    streamKeepAliveTimeoutTime?: number;
    logger?: Logger;
    idGen?: IdGen;
    toError?: ToError;
  }) {
    this.idGen = idGen;
    this.callerTypes = utils.getHandlerTypes(manifest);
    this.streamFactory = streamFactory;
    this.middlewareFactory = middlewareFactory;
    this.streamKeepAliveTimeoutTime = streamKeepAliveTimeoutTime;
    this.logger = logger ?? new Logger(this.constructor.name);
    this.toError = toError;
  }

  public get methods(): MapCallers<M> {
    return this.methodsProxy as MapCallers<M>;
  }

  /**
   * Generic caller for unary RPC calls.
   * This returns the response in the provided type. No validation is done so
   * make sure the types match the handler types.
   * @param method - Method name of the RPC call
   * @param parameters - Parameters to be provided with the RPC message. Matches
   * the provided I type.
   * @param ctx - ContextTimed used for timeouts and cancellation.
   */
  public async unaryCaller<I extends JSONValue, O extends JSONValue>(
    method: string,
    parameters: I,
    ctx: Partial<ContextTimedInput> = {},
  ): Promise<O> {
    const callerInterface = await this.duplexStreamCaller<I, O>(method, ctx);
    const reader = callerInterface.readable.getReader();
    const writer = callerInterface.writable.getWriter();
    try {
      await writer.write(parameters);
      const output = await reader.read();
      if (output.done) {
        throw new errors.ErrorMissingCaller('Missing response', {
          cause: ctx.signal?.reason,
        });
      }
      await reader.cancel();
      await writer.close();
      return output.value;
    } finally {
      // Attempt clean up, ignore errors if already cleaned up
      await reader.cancel().catch(() => {});
      await writer.close().catch(() => {});
    }
  }

  /**
   * Generic caller for server streaming RPC calls.
   * This returns a ReadableStream of the provided type. When finished, the
   * readable needs to be cleaned up, otherwise cleanup happens mostly
   * automatically.
   * @param method - Method name of the RPC call
   * @param parameters - Parameters to be provided with the RPC message. Matches
   * the provided I type.
   * @param ctx - ContextTimed used for timeouts and cancellation.
   */
  public async serverStreamCaller<I extends JSONValue, O extends JSONValue>(
    method: string,
    parameters: I,
    ctx: Partial<ContextTimedInput> = {},
  ): Promise<ReadableStream<O>> {
    const callerInterface = await this.duplexStreamCaller<I, O>(method, ctx);
    const writer = callerInterface.writable.getWriter();
    try {
      await writer.write(parameters);
      await writer.close();
    } catch (e) {
      // Clean up if any problems, ignore errors if already closed
      await callerInterface.readable.cancel(e);
      throw e;
    }
    return callerInterface.readable;
  }

  /**
   * Generic caller for Client streaming RPC calls.
   * This returns a WritableStream for writing the input to and a Promise that
   * resolves when the output is received.
   * When finished the writable stream must be ended. Failing to do so will
   * hold the connection open and result in a resource leak until the
   * call times out.
   * @param method - Method name of the RPC call
   * @param ctx - ContextTimed used for timeouts and cancellation.
   */
  public async clientStreamCaller<I extends JSONValue, O extends JSONValue>(
    method: string,
    ctx: Partial<ContextTimedInput> = {},
  ): Promise<{
    output: Promise<O>;
    writable: WritableStream<I>;
  }> {
    const callerInterface = await this.duplexStreamCaller<I, O>(method, ctx);
    const reader = callerInterface.readable.getReader();
    const output = reader.read().then(({ value, done }) => {
      if (done) {
        throw new errors.ErrorMissingCaller('Missing response', {
          cause: ctx.signal?.reason,
        });
      }
      return value;
    });
    return {
      output,
      writable: callerInterface.writable,
    };
  }

  /**
   * Generic caller for duplex RPC calls.
   * This returns a `ReadableWritablePair` of the types specified. No validation
   * is applied to these types so make sure they match the types of the handler
   * you are calling.
   * When finished the streams must be ended manually. Failing to do so will
   * hold the connection open and result in a resource leak until the
   * call times out.
   * @param method - Method name of the RPC call
   * @param ctx - ContextTimed used for timeouts and cancellation.
   */
  public async duplexStreamCaller<I extends JSONValue, O extends JSONValue>(
    method: string,
    ctx: Partial<ContextTimedInput> = {},
  ): Promise<RPCStream<O, I>> {
    // Setting up abort signal and timer
    const abortController = new AbortController();
    const signal = abortController.signal;
    // A promise that will reject if there is an abort signal or timeout
    const abortRaceProm = utils.promise<never>();
    // Prevent unhandled rejection when we're done with the promise
    abortRaceProm.p.catch(() => {});
    const abortRacePromHandler = () => {
      abortRaceProm.rejectP(signal.reason);
    };
    signal.addEventListener('abort', abortRacePromHandler);

    let abortHandler: () => void;
    if (ctx.signal != null) {
      // Propagate signal events
      abortHandler = () => {
        abortController.abort(ctx.signal?.reason);
      };
      if (ctx.signal.aborted) abortHandler();
      ctx.signal.addEventListener('abort', abortHandler);
    }
    let timer: Timer;
    if (!(ctx.timer instanceof Timer)) {
      timer = new Timer({
        delay: ctx.timer ?? this.streamKeepAliveTimeoutTime,
      });
    } else {
      timer = ctx.timer;
    }
    const cleanUp = () => {
      // Clean up the timer and signal
      if (ctx.timer == null) timer.cancel(timerCleanupReasonSymbol);
      if (ctx.signal != null) {
        ctx.signal.removeEventListener('abort', abortHandler);
      }
      signal.addEventListener('abort', abortRacePromHandler);
    };
    // Setting up abort events for timeout
    const timeoutError = new errors.ErrorRPCTimedOut(
      'Error RPC has timed out',
      { cause: ctx.signal?.reason },
    );
    void timer.then(
      () => {
        abortController.abort(timeoutError);
        if (this.onTimeoutCallback) {
          this.onTimeoutCallback();
        }
      },
      () => {}, // Ignore cancellation error
    );

    // Hooking up agnostic stream side
    let rpcStream: RPCStream<Uint8Array, Uint8Array>;
    const streamFactoryProm = this.streamFactory({ signal, timer });
    try {
      rpcStream = await Promise.race([streamFactoryProm, abortRaceProm.p]);
    } catch (e) {
      cleanUp();
      void streamFactoryProm.then((stream) =>
        stream.cancel(errors.ErrorRPCStreamEnded),
      );
      throw e;
    }
    void timer.then(
      () => {
        rpcStream.cancel(
          new errors.ErrorRPCTimedOut('RPC has timed out', {
            cause: ctx.signal?.reason,
          }),
        );
      },
      () => {}, // Ignore cancellation error
    );
    // Deciding if we want to allow refreshing
    // We want to refresh timer if none was provided
    const refreshingTimer: Timer | undefined =
      ctx.timer == null ? timer : undefined;
    // Composing stream transforms and middleware
    const metadata = {
      ...(rpcStream.meta ?? {}),
      command: method,
    };
    const outputMessageTransformStream = utils.clientOutputTransformStream<O>(
      metadata,
      refreshingTimer,
    );
    const inputMessageTransformStream = utils.clientInputTransformStream<I>(
      method,
      refreshingTimer,
    );
    const middleware = this.middlewareFactory(
      { signal, timer },
      rpcStream.cancel,
      metadata,
    );
    // This `Promise.allSettled` is used to asynchronously track the state
    // of the streams. When both have finished we can clean up resources.
    void Promise.allSettled([
      rpcStream.readable
        .pipeThrough(middleware.reverse)
        .pipeTo(outputMessageTransformStream.writable)
        // Ignore any errors, we only care about stream ending
        .catch(() => {}),
      inputMessageTransformStream.readable
        .pipeThrough(middleware.forward)
        .pipeTo(rpcStream.writable)
        // Ignore any errors, we only care about stream ending
        .catch(() => {}),
    ]).finally(() => {
      cleanUp();
    });

    // Returning interface
    return {
      readable: outputMessageTransformStream.readable,
      writable: inputMessageTransformStream.writable,
      cancel: rpcStream.cancel,
      meta: metadata,
    };
  }

  /**
   * Generic caller for raw RPC calls.
   * This returns a `ReadableWritablePair` of the raw RPC stream.
   * When finished the streams must be ended manually. Failing to do so will
   * hold the connection open and result in a resource leak until the
   * call times out.
   * Raw streams don't support the keep alive timeout. Timeout will only apply\
   * to the creation of the stream.
   * @param method - Method name of the RPC call
   * @param headerParams - Parameters for the header message. The header is a
   * single RPC message that is sent to specify the method for the RPC call.
   * Any metadata of extra parameters is provided here.
   * @param ctx - ContextTimed used for timeouts and cancellation.
   * @param id - Id is generated only once, and used throughout the stream for the rest of the communication
   */
  public async rawStreamCaller(
    method: string,
    headerParams: JSONValue,
    ctx: Partial<ContextTimedInput> = {},
  ): Promise<
    RPCStream<
      Uint8Array,
      Uint8Array,
      Record<string, JSONValue> & { result: JSONValue; command: string }
    >
  > {
    // Setting up abort signal and timer
    const abortController = new AbortController();
    const signal = abortController.signal;
    // A promise that will reject if there is an abort signal or timeout
    const abortRaceProm = utils.promise<never>();
    // Prevent unhandled rejection when we're done with the promise
    abortRaceProm.p.catch(() => {});
    const abortRacePromHandler = () => {
      abortRaceProm.rejectP(signal.reason);
    };
    signal.addEventListener('abort', abortRacePromHandler);

    let abortHandler: () => void;
    if (ctx.signal != null) {
      // Propagate signal events
      abortHandler = () => {
        abortController.abort(ctx.signal?.reason);
      };
      if (ctx.signal.aborted) abortHandler();
      ctx.signal.addEventListener('abort', abortHandler);
    }
    let timer: Timer;
    if (!(ctx.timer instanceof Timer)) {
      timer = new Timer({
        delay: ctx.timer ?? this.streamKeepAliveTimeoutTime,
      });
    } else {
      timer = ctx.timer;
    }
    const cleanUp = () => {
      // Clean up the timer and signal
      if (ctx.timer == null) timer.cancel(timerCleanupReasonSymbol);
      if (ctx.signal != null) {
        ctx.signal.removeEventListener('abort', abortHandler);
      }
      signal.addEventListener('abort', abortRacePromHandler);
    };
    // Setting up abort events for timeout
    const timeoutError = new errors.ErrorRPCTimedOut('RPC has timed out', {
      cause: ctx.signal?.reason,
    });
    void timer.then(
      () => {
        abortController.abort(timeoutError);
      },
      () => {}, // Ignore cancellation error
    );

    const setupStream = async (): Promise<
      [JSONValue, RPCStream<Uint8Array, Uint8Array>]
    > => {
      if (signal.aborted) throw signal.reason;
      const abortProm = utils.promise<never>();
      // Ignore error if orphaned
      void abortProm.p.catch(() => {});
      signal.addEventListener(
        'abort',
        () => {
          abortProm.rejectP(signal.reason);
        },
        { once: true },
      );
      const rpcStream = await Promise.race([
        this.streamFactory({ signal, timer }),
        abortProm.p,
      ]);
      const tempWriter = rpcStream.writable.getWriter();
      const id = await this.idGen();
      const header: JSONRPCRequestMessage = {
        jsonrpc: '2.0',
        method,
        params: headerParams,
        id,
      };
      await tempWriter.write(Buffer.from(JSON.stringify(header)));
      tempWriter.releaseLock();
      const headTransformStream = utils.parseHeadStream(
        utils.parseJSONRPCResponse,
      );
      void rpcStream.readable
        // Allow us to re-use the readable after reading the first message
        .pipeTo(headTransformStream.writable)
        // Ignore any errors here, we only care that it ended
        .catch(() => {});
      const tempReader = headTransformStream.readable.getReader();
      let leadingMessage: JSONRPCResponseResult;
      try {
        const message = await Promise.race([tempReader.read(), abortProm.p]);
        const messageValue = message.value as JSONRPCResponse;
        if (message.done) utils.never();
        if ('error' in messageValue) {
          const metadata = {
            ...(rpcStream.meta ?? {}),
            command: method,
          };
          if (messageValue.error.code === JSONRPCErrorCode.RPCRemote) {
            throw this.toError(JSON.parse(messageValue.error.data as string), metadata);
          }
          throw errors.ErrorRPCProtocol.fromJSON(messageValue.error);
        }
        leadingMessage = messageValue;
      } catch (e) {
        rpcStream.cancel(
          new errors.ErrorRPCStreamEnded('RPC Stream Ended', { cause: e }),
        );
        throw e;
      }
      tempReader.releaseLock();
      const newRpcStream: RPCStream<Uint8Array, Uint8Array> = {
        writable: rpcStream.writable,
        readable: headTransformStream.readable as ReadableStream<Uint8Array>,
        cancel: rpcStream.cancel,
        meta: rpcStream.meta,
      };
      return [leadingMessage.result, newRpcStream];
    };
    let streamCreation: [JSONValue, RPCStream<Uint8Array, Uint8Array>];
    try {
      streamCreation = await setupStream();
    } finally {
      cleanUp();
    }
    const [result, rpcStream] = streamCreation;
    const metadata = {
      ...(rpcStream.meta ?? {}),
      result,
      command: method,
    };
    return {
      writable: rpcStream.writable,
      readable: rpcStream.readable,
      cancel: rpcStream.cancel,
      meta: metadata,
    };
  }
}

export default RPCClient;
