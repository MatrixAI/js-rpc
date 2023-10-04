import type { ReadableStreamDefaultReadResult } from 'stream/web';
import type {
  ClientHandlerImplementation,
  DuplexHandlerImplementation,
  JSONRPCError,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCResponseError,
  JSONRPCResponseResult,
  ServerManifest,
  RawHandlerImplementation,
  ServerHandlerImplementation,
  UnaryHandlerImplementation,
  RPCStream,
  MiddlewareFactory,
} from './types';
import type { JSONValue } from './types';
import type { IdGen } from './types';
import type { ErrorRPC, ErrorRPCRemote } from './errors';
import { ReadableStream, TransformStream } from 'stream/web';
import { ready } from '@matrixai/async-init/dist/StartStop';
import Logger from '@matrixai/logger';
import { PromiseCancellable } from '@matrixai/async-cancellable';
import { Timer } from '@matrixai/timer';
import { startStop } from '@matrixai/async-init';
import { RawHandler } from './handlers';
import { DuplexHandler } from './handlers';
import { ServerHandler } from './handlers';
import { UnaryHandler } from './handlers';
import { ClientHandler } from './handlers';
import * as rpcEvents from './events';
import * as rpcUtils from './utils';
import * as rpcErrors from './errors';
import * as rpcUtilsMiddleware from './middleware';
import { ErrorHandlerAborted, JSONRPCErrorCode, never } from './errors';
import * as events from './events';

const cleanupReason = Symbol('CleanupReason');

/**
 * You must provide a error handler `addEventListener('error')`.
 * Otherwise errors will just be ignored.
 *
 * Events:
 * - error
 */
interface RPCServer extends startStop.StartStop {}

@startStop.StartStop({
  eventStart: events.EventRPCServerStart,
  eventStarted: events.EventRPCServerStarted,
  eventStop: events.EventRPCServerStopping,
  eventStopped: events.EventRPCServerStopped,
})
class RPCServer extends EventTarget {
  /**
   * Starts RPC server.

   * @param obj
   * @param obj.manifest - Server manifest used to define the rpc method
   * handlers.
   * @param obj.middlewareFactory - Middleware used to process the rpc messages.
   * The middlewareFactory needs to be a function that creates a pair of
   * transform streams that convert `Uint8Array` to `JSONRPCRequest` on the forward
   * path and `JSONRPCResponse` to `Uint8Array` on the reverse path.
   * @param obj.streamKeepAliveTimeoutTime - Time before a connection is cleaned up due to no activity. This is the
   * value used if the handler doesn't specify its own timeout time. This timeout is advisory and only results in a
   * signal sent to the handler. Stream is forced to end after the timeoutForceCloseTime. Defaults to 60,000
   * milliseconds.
   * @param obj.timeoutForceCloseTime - Time before the stream is forced to end after the initial timeout time.
   * The stream will be forced to close after this amount of time after the initial timeout. This is a grace period for
   * the handler to handle timeout before it is forced to end. Defaults to 2,000 milliseconds.
   * @param obj.logger
   */
  public static async start({
    manifest,
    middlewareFactory = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(),
    handlerTimeoutTime = Infinity, // 1 minute
    logger = new Logger(this.name),
    idGen = () => Promise.resolve(null),
    fromError = rpcUtils.fromError,
    filterSensitive = rpcUtils.filterSensitive,
  }: {
    manifest: ServerManifest;
    middlewareFactory?: MiddlewareFactory<
      JSONRPCRequest,
      Uint8Array,
      Uint8Array,
      JSONRPCResponse
    >;
    handlerTimeoutTime?: number;
    logger?: Logger;
    idGen?: IdGen;
    fromError?: (error: ErrorRPC<any>) => JSONValue;
    filterSensitive?: (key: string, value: any) => any;
  }): Promise<RPCServer> {
    logger.info(`Starting ${this.name}`);
    const rpcServer = new this({
      manifest,
      middlewareFactory,
      handlerTimeoutTime,
      logger,
      idGen,
      fromError,
      filterSensitive,
    });
    logger.info(`Started ${this.name}`);
    return rpcServer;
  }
  protected onTimeoutCallback?: () => void;
  protected idGen: IdGen;
  protected logger: Logger;
  protected handlerMap: Map<string, RawHandlerImplementation> = new Map();
  protected defaultTimeoutMap: Map<string, number | undefined> = new Map();
  protected handlerTimeoutTime: number;
  protected activeStreams: Set<PromiseCancellable<void>> = new Set();
  protected fromError: (error: ErrorRPC<any>) => JSONValue;
  protected filterSensitive: (key: string, value: any) => any;
  protected middlewareFactory: MiddlewareFactory<
    JSONRPCRequest,
    Uint8Array,
    Uint8Array,
    JSONRPCResponseResult
  >;
  // Function to register a callback for timeout
  public registerOnTimeoutCallback(callback: () => void) {
    this.onTimeoutCallback = callback;
  }
  public constructor({
    manifest,
    middlewareFactory,
    handlerTimeoutTime = Infinity,
    logger,
    idGen = () => Promise.resolve(null),
    fromError = rpcUtils.fromError,
    filterSensitive = rpcUtils.filterSensitive,
  }: {
    manifest: ServerManifest;

    middlewareFactory: MiddlewareFactory<
      JSONRPCRequest,
      Uint8Array,
      Uint8Array,
      JSONRPCResponseResult
    >;
    handlerTimeoutTime?: number;
    logger: Logger;
    idGen: IdGen;
    fromError?: (error: ErrorRPC<any>) => JSONValue;
    filterSensitive?: (key: string, value: any) => any;
  }) {
    super();
    for (const [key, manifestItem] of Object.entries(manifest)) {
      if (manifestItem instanceof RawHandler) {
        this.registerRawStreamHandler(
          key,
          manifestItem.handle,
          manifestItem.timeout,
        );
        continue;
      }
      if (manifestItem instanceof DuplexHandler) {
        this.registerDuplexStreamHandler(
          key,
          manifestItem.handle,
          manifestItem.timeout,
        );
        continue;
      }
      if (manifestItem instanceof ServerHandler) {
        this.registerServerStreamHandler(
          key,
          manifestItem.handle,
          manifestItem.timeout,
        );
        continue;
      }
      if (manifestItem instanceof ClientHandler) {
        this.registerClientStreamHandler(
          key,
          manifestItem.handle,
          manifestItem.timeout,
        );
        continue;
      }
      if (manifestItem instanceof ClientHandler) {
        this.registerClientStreamHandler(
          key,
          manifestItem.handle,
          manifestItem.timeout,
        );
        continue;
      }
      if (manifestItem instanceof UnaryHandler) {
        this.registerUnaryHandler(
          key,
          manifestItem.handle,
          manifestItem.timeout,
        );
        continue;
      }
      never();
    }
    this.idGen = idGen;
    this.middlewareFactory = middlewareFactory;
    this.handlerTimeoutTime = handlerTimeoutTime;
    this.logger = logger;
    this.fromError = fromError || rpcUtils.fromError;
    this.filterSensitive = filterSensitive || rpcUtils.filterSensitive;
  }

  public async stop({
    force = true,
    reason = '',
  }: {
    force?: boolean;
    reason?: string;
  }): Promise<void> {
    // Log an event before starting the destruction
    this.logger.info(`Stopping ${this.constructor.name}`);

    // Your existing logic for stopping active streams and other cleanup
    if (force) {
      for await (const [activeStream] of this.activeStreams.entries()) {
        activeStream.cancel(new rpcErrors.ErrorRPCStopping());
      }
    }

    for await (const [activeStream] of this.activeStreams.entries()) {
      await activeStream;
    }

    // Log  an event after the destruction has been completed
    this.logger.info(`Stopped ${this.constructor.name}`);
  }

  /**
   * Registers a raw stream handler. This is the basis for all handlers as
   * handling the streams is done with raw streams only.
   * The raw streams do not automatically refresh the timeout timer when
   * messages are sent or received.
   */
  protected registerRawStreamHandler(
    method: string,
    handler: RawHandlerImplementation,
    timeout: number | undefined,
  ) {
    this.handlerMap.set(method, handler);
    this.defaultTimeoutMap.set(method, timeout);
  }

  /**
   * Registers a duplex stream handler.
   * This handles all message parsing and conversion from generators
   * to raw streams.
   *
   * @param method - The rpc method name.
   * @param handler - The handler takes an input async iterable and returns an output async iterable.
   * @param timeout
   */
  /**
   * The ID is generated only once when the function is called and stored in the id variable.
   * the ID is associated with the entire stream
   * Every response (whether successful or an error) produced within this stream will have the
   * same ID, which is consistent with the originating request.
   */
  protected registerDuplexStreamHandler<
    I extends JSONValue,
    O extends JSONValue,
  >(
    method: string,
    handler: DuplexHandlerImplementation<I, O>,
    timeout: number | undefined,
  ): void {
    const rawSteamHandler: RawHandlerImplementation = async (
      [header, input],
      cancel,
      meta,
      ctx,
    ) => {
      // Setting up abort controller
      const abortController = new AbortController();
      if (ctx.signal.aborted) abortController.abort(ctx.signal.reason);
      ctx.signal.addEventListener('abort', () => {
        abortController.abort(ctx.signal.reason);
      });
      const signal = abortController.signal;
      // Setting up middleware
      const middleware = this.middlewareFactory(ctx, cancel, meta);
      // Forward from the client to the server
      // Transparent TransformStream that re-inserts the header message into the
      // stream.
      const headerStream = new TransformStream({
        start(controller) {
          controller.enqueue(Buffer.from(JSON.stringify(header)));
        },
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
      const forwardStream = input
        .pipeThrough(headerStream)
        .pipeThrough(middleware.forward);
      // Reverse from the server to the client
      const reverseStream = middleware.reverse.writable;
      // Generator derived from handler
      const id = await this.idGen();
      const outputGen = async function* (): AsyncGenerator<JSONRPCResponse> {
        if (signal.aborted) throw signal.reason;
        // Input generator derived from the forward stream
        const inputGen = async function* (): AsyncIterable<I> {
          for await (const data of forwardStream) {
            ctx.timer.refresh();
            yield data.params as I;
          }
        };
        const handlerG = handler(inputGen(), cancel, meta, {
          signal,
          timer: ctx.timer,
        });
        for await (const response of handlerG) {
          ctx.timer.refresh();
          const responseMessage: JSONRPCResponseResult = {
            jsonrpc: '2.0',
            result: response,
            id,
          };
          yield responseMessage;
        }
      };
      const outputGenerator = outputGen();
      const reverseMiddlewareStream = new ReadableStream<JSONRPCResponse>({
        pull: async (controller) => {
          try {
            const { value, done } = await outputGenerator.next();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          } catch (e) {
            const rpcError: JSONRPCError = {
              code: e.exitCode ?? JSONRPCErrorCode.InternalError,
              message: e.description ?? '',
              data: JSON.stringify(this.fromError(e), this.filterSensitive),
              type: e.type,
            };
            const rpcErrorMessage: JSONRPCResponseError = {
              jsonrpc: '2.0',
              error: rpcError,
              id,
            };
            controller.enqueue(rpcErrorMessage);
            // Clean up the input stream here, ignore error if already ended
            await forwardStream
              .cancel(
                new rpcErrors.ErrorRPCHandlerFailed('Error clean up', {
                  cause: e,
                }),
              )
              .catch(() => {});
            controller.close();
          }
        },
        cancel: async (reason) => {
          this.dispatchEvent(
            new rpcEvents.RPCErrorEvent({
              detail: new rpcErrors.ErrorRPCStreamEnded(
                'Stream has been cancelled',
                {
                  cause: reason,
                },
              ),
            }),
          );
          // Abort with the reason
          abortController.abort(reason);
          // If the output stream path fails then we need to end the generator
          // early.
          await outputGenerator.return(undefined);
        },
      });
      // Ignore any errors here, it should propagate to the ends of the stream
      void reverseMiddlewareStream.pipeTo(reverseStream).catch(() => {});
      return [undefined, middleware.reverse.readable];
    };
    this.registerRawStreamHandler(method, rawSteamHandler, timeout);
  }

  protected registerUnaryHandler<I extends JSONValue, O extends JSONValue>(
    method: string,
    handler: UnaryHandlerImplementation<I, O>,
    timeout: number | undefined,
  ) {
    const wrapperDuplex: DuplexHandlerImplementation<I, O> = async function* (
      input,
      cancel,
      meta,
      ctx,
    ) {
      // The `input` is expected to be an async iterable with only 1 value.
      // Unlike generators, there is no `next()` method.
      // So we use `break` after the first iteration.
      for await (const inputVal of input) {
        yield await handler(inputVal, cancel, meta, ctx);
        break;
      }
    };
    this.registerDuplexStreamHandler(method, wrapperDuplex, timeout);
  }

  protected registerServerStreamHandler<
    I extends JSONValue,
    O extends JSONValue,
  >(
    method: string,
    handler: ServerHandlerImplementation<I, O>,
    timeout: number | undefined,
  ) {
    const wrapperDuplex: DuplexHandlerImplementation<I, O> = async function* (
      input,
      cancel,
      meta,
      ctx,
    ) {
      for await (const inputVal of input) {
        yield* handler(inputVal, cancel, meta, ctx);
        break;
      }
    };
    this.registerDuplexStreamHandler(method, wrapperDuplex, timeout);
  }

  protected registerClientStreamHandler<
    I extends JSONValue,
    O extends JSONValue,
  >(
    method: string,
    handler: ClientHandlerImplementation<I, O>,
    timeout: number | undefined,
  ) {
    const wrapperDuplex: DuplexHandlerImplementation<I, O> = async function* (
      input,
      cancel,
      meta,
      ctx,
    ) {
      yield await handler(input, cancel, meta, ctx);
    };
    this.registerDuplexStreamHandler(method, wrapperDuplex, timeout);
  }

  /**
   * ID is associated with the stream, not individual messages.
   */
  public handleStream(rpcStream: RPCStream<Uint8Array, Uint8Array>) {
    // This will take a buffer stream of json messages and set up service
    //  handling for it.
    // Constructing the PromiseCancellable for tracking the active stream
    const abortController = new AbortController();
    // Setting up timeout timer logic
    const timer = new Timer({
      delay: this.handlerTimeoutTime,
      handler: () => {
        abortController.abort(new rpcErrors.ErrorRPCTimedOut());
        if (this.onTimeoutCallback) {
          this.onTimeoutCallback();
        }
      },
    });

    const prom = (async () => {
      const id = await this.idGen();
      const headTransformStream = rpcUtilsMiddleware.binaryToJsonMessageStream(
        rpcUtils.parseJSONRPCRequest,
      );
      // Transparent transform used as a point to cancel the input stream from
      const passthroughTransform = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const inputStream = passthroughTransform.readable;
      const inputStreamEndProm = rpcStream.readable
        .pipeTo(passthroughTransform.writable)
        // Ignore any errors here, we only care that it ended
        .catch(() => {});
      void inputStream
        // Allow us to re-use the readable after reading the first message
        .pipeTo(headTransformStream.writable, {
          preventClose: true,
          preventCancel: true,
        })
        // Ignore any errors here, we only care that it ended
        .catch(() => {});
      const cleanUp = async (reason: any) => {
        await inputStream.cancel(reason);
        await rpcStream.writable.abort(reason);
        await inputStreamEndProm;
        timer.cancel(cleanupReason);
        await timer.catch(() => {});
      };
      // Read a single empty value to consume the first message
      const reader = headTransformStream.readable.getReader();
      // Allows timing out when waiting for the first message
      let headerMessage:
        | ReadableStreamDefaultReadResult<JSONRPCRequest>
        | undefined
        | void;
      try {
        headerMessage = await Promise.race([
          reader.read(),
          timer.then(
            () => undefined,
            () => {},
          ),
        ]);
      } catch (e) {
        const newErr = new rpcErrors.ErrorRPCHandlerFailed(
          'Stream failed waiting for header',
          { cause: e },
        );
        await inputStreamEndProm;
        timer.cancel(cleanupReason);
        await timer.catch(() => {});
        this.dispatchEvent(
          new rpcEvents.RPCErrorEvent({
            detail: new rpcErrors.ErrorRPCOutputStreamError(
              'Stream failed waiting for header',
              {
                cause: newErr,
              },
            ),
          }),
        );
        return;
      }
      // Downgrade back to the raw stream
      await reader.cancel();
      // There are 2 conditions where we just end here
      //  1. The timeout timer resolves before the first message
      //  2. the stream ends before the first message
      if (headerMessage == null) {
        const newErr = new rpcErrors.ErrorRPCTimedOut(
          'Timed out waiting for header',
          { cause: new rpcErrors.ErrorRPCStreamEnded() },
        );
        await cleanUp(newErr);
        this.dispatchEvent(
          new rpcEvents.RPCErrorEvent({
            detail: new rpcErrors.ErrorRPCTimedOut(
              'Timed out waiting for header',
              {
                cause: newErr,
              },
            ),
          }),
        );
        return;
      }
      if (headerMessage.done) {
        const newErr = new rpcErrors.ErrorMissingHeader('Missing header');
        await cleanUp(newErr);
        this.dispatchEvent(
          new rpcEvents.RPCErrorEvent({
            detail: new rpcErrors.ErrorRPCOutputStreamError('Missing header', {
              cause: newErr,
            }),
          }),
        );
        return;
      }
      const method = headerMessage.value.method;
      const handler = this.handlerMap.get(method);
      if (handler == null) {
        await cleanUp(new rpcErrors.ErrorRPCHandlerFailed('Missing handler'));
        return;
      }
      if (abortController.signal.aborted) {
        await cleanUp(
          new rpcErrors.ErrorHandlerAborted('Aborted', {
            cause: new ErrorHandlerAborted(),
          }),
        );
        return;
      }
      // Setting up Timeout logic
      const timeout = this.defaultTimeoutMap.get(method);
      if (timeout != null && timeout < this.handlerTimeoutTime) {
        // Reset timeout with new delay if it is less than the default
        timer.reset(timeout);
      } else {
        // Otherwise refresh
        timer.refresh();
      }
      this.logger.info(`Handling stream with method (${method})`);
      let handlerResult: [JSONValue | undefined, ReadableStream<Uint8Array>];
      const headerWriter = rpcStream.writable.getWriter();
      try {
        handlerResult = await handler(
          [headerMessage.value, inputStream],
          rpcStream.cancel,
          rpcStream.meta,
          { signal: abortController.signal, timer },
        );
      } catch (e) {
        const rpcError: JSONRPCError = {
          code: e.exitCode ?? JSONRPCErrorCode.InternalError,
          message: e.description ?? '',
          data: JSON.stringify(this.fromError(e), this.filterSensitive),
          type: e.type,
        };
        const rpcErrorMessage: JSONRPCResponseError = {
          jsonrpc: '2.0',
          error: rpcError,
          id,
        };
        await headerWriter.write(Buffer.from(JSON.stringify(rpcErrorMessage)));
        await headerWriter.close();
        // Clean up and return
        timer.cancel(cleanupReason);
        rpcStream.cancel(Error('TMP header message was an error'));
        return;
      }
      const [leadingResult, outputStream] = handlerResult;

      if (leadingResult !== undefined) {
        // Writing leading metadata
        const leadingMessage: JSONRPCResponseResult = {
          jsonrpc: '2.0',
          result: leadingResult,
          id,
        };
        await headerWriter.write(Buffer.from(JSON.stringify(leadingMessage)));
      }
      headerWriter.releaseLock();
      const outputStreamEndProm = outputStream
        .pipeTo(rpcStream.writable)
        .catch(() => {}); // Ignore any errors, we only care that it finished
      await Promise.allSettled([inputStreamEndProm, outputStreamEndProm]);
      this.logger.info(`Handled stream with method (${method})`);
      // Cleaning up abort and timer
      timer.cancel(cleanupReason);
      abortController.abort(new rpcErrors.ErrorRPCStreamEnded());
    })();
    const handlerProm = PromiseCancellable.from(prom, abortController).finally(
      () => this.activeStreams.delete(handlerProm),
      abortController,
    );
    // Putting the PromiseCancellable into the active streams map
    this.activeStreams.add(handlerProm);
  }
}

export default RPCServer;
