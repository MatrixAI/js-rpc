import type { ReadableStreamDefaultReadResult } from 'stream/web';
import type {
  IdGen,
  ClientHandlerImplementation,
  DuplexHandlerImplementation,
  JSONValue,
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
  FromError,
} from './types';
import { ReadableStream, TransformStream } from 'stream/web';
import Logger from '@matrixai/logger';
import { PromiseCancellable } from '@matrixai/async-cancellable';
import { Timer } from '@matrixai/timer';
import { startStop } from '@matrixai/async-init';
import { StartStop } from '@matrixai/async-init/dist/StartStop';
import { RawHandler } from './handlers';
import {
  DuplexHandler,
  ServerHandler,
  UnaryHandler,
  ClientHandler,
} from './handlers';
import * as utils from './utils';
import * as errors from './errors';
import * as middleware from './middleware';
import * as events from './events';
import { POJO } from '@matrixai/errors';

const cleanupReason = Symbol('CleanupReason');

/**
 * You must provide a error handler `addEventListener('error')`.
 * Otherwise errors will just be ignored.
 *
 * Events:
 * - error
 */
interface RPCServer extends startStop.StartStop {}

@StartStop({
  eventStart: events.EventRPCServerStart,
  eventStarted: events.EventRPCServerStarted,
  eventStop: events.EventRPCServerStopping,
  eventStopped: events.EventRPCServerStopped,
})
class RPCServer {
  protected onTimeoutCallback?: () => void;
  protected idGen: IdGen;
  protected logger: Logger;
  protected handlerMap: Map<string, RawHandlerImplementation> = new Map();
  protected defaultTimeoutMap: Map<string, number | undefined> = new Map();
  protected handlerTimeoutTime: number;
  protected activeStreams: Set<PromiseCancellable<void>> = new Set();
  protected fromError: FromError;
  protected replacer?: (key: string, value: any) => any;
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

  /**
   * RPCServer Constructor
   *
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
  public constructor({
    middlewareFactory = middleware.defaultServerMiddlewareWrapper(),
    handlerTimeoutTime = Infinity,
    logger,
    idGen = () => Promise.resolve(null),
    fromError = utils.fromError,
    replacer,
  }: {
    middlewareFactory?: MiddlewareFactory<
      JSONRPCRequest,
      Uint8Array,
      Uint8Array,
      JSONRPCResponseResult
    >;
    handlerTimeoutTime?: number;
    logger?: Logger;
    idGen?: IdGen;
    fromError?: FromError;
    replacer?: (key: string, value: any) => any;
  }) {
    this.idGen = idGen;
    this.middlewareFactory = middlewareFactory;
    this.handlerTimeoutTime = handlerTimeoutTime;
    this.fromError = fromError;
    this.replacer = replacer;
    this.logger = logger ?? new Logger(this.constructor.name);
  }

  /**
   * Starts RPC server.

   * @param obj
   * @param obj.manifest - Server manifest used to define the rpc method handlers.
   */
  public async start({
    manifest,
  }: {
    manifest: ServerManifest;
  }): Promise<void> {
    this.logger.info(`Start ${this.constructor.name}`);
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
      utils.never();
    }
    this.logger.info(`Started ${this.constructor.name}`);
  }

  public async stop({
    force = true,
    reason = new errors.ErrorRPCStopping('RPCServer is stopping'),
  }: {
    force?: boolean;
    reason?: any;
  }): Promise<void> {
    // Log an event before starting the destruction
    this.logger.info(`Stop ${this.constructor.name}`);

    // Your existing logic for stopping active streams and other cleanup
    const handlerPs = new Array<PromiseCancellable<void>>();
    if (force) {
      for await (const [activeStream] of this.activeStreams.entries()) {
        if (force) activeStream.cancel(reason);
        handlerPs.push(activeStream);
      }
      await Promise.all(handlerPs);
    }

    for await (const [activeStream] of this.activeStreams.entries()) {
      await activeStream;
    }

    // Removes handlers and default timeouts registered in `RPCServer.start()`
    this.handlerMap.clear();
    this.defaultTimeoutMap.clear();

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
            let rpcError: JSONRPCError
            if (e instanceof errors.ErrorRPCProtocol) {
              rpcError = e.toJSON();
            }
            else {
              rpcError = new errors.ErrorRPCRemote(e?.message).toJSON();
              (rpcError.data as POJO).cause = JSON.stringify(this.fromError(e), this.replacer);
            }
            const rpcErrorMessage: JSONRPCResponseError = {
              jsonrpc: '2.0',
              error: rpcError,
              id,
            };
            controller.enqueue(rpcErrorMessage);
            // Clean up the input stream here, ignore error if already ended
            await forwardStream
              .cancel(
                new errors.ErrorRPCHandlerFailed('Error clean up', {
                  cause: e,
                }),
              )
              .catch(() => {});
            controller.close();
          }
        },
        cancel: async (reason) => {
          this.dispatchEvent(
            new events.RPCErrorEvent({
              detail: new errors.ErrorRPCStreamEnded(
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
  @startStop.ready(new errors.ErrorRPCServerNotRunning())
  public handleStream(rpcStream: RPCStream<Uint8Array, Uint8Array>) {
    // This will take a buffer stream of json messages and set up service
    //  handling for it.
    // Constructing the PromiseCancellable for tracking the active stream
    const abortController = new AbortController();
    // Setting up timeout timer logic
    const timer = new Timer({
      delay: this.handlerTimeoutTime,
      handler: () => {
        abortController.abort(new errors.ErrorRPCTimedOut());
        if (this.onTimeoutCallback) {
          this.onTimeoutCallback();
        }
      },
    });

    const prom = (async () => {
      const id = await this.idGen();
      const headTransformStream = middleware.binaryToJsonMessageStream(
        utils.parseJSONRPCRequest,
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
        const newErr = new errors.ErrorRPCHandlerFailed(
          'Stream failed waiting for header',
          { cause: e },
        );
        await inputStreamEndProm;
        timer.cancel(cleanupReason);
        await timer.catch(() => {});
        this.dispatchEvent(
          new events.RPCErrorEvent({
            detail: new errors.ErrorRPCOutputStreamError(),
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
        const newErr = new errors.ErrorRPCTimedOut(
          'Timed out waiting for header',
          { cause: new errors.ErrorRPCStreamEnded() },
        );
        await cleanUp(newErr);
        this.dispatchEvent(
          new events.RPCErrorEvent({
            detail: new errors.ErrorRPCTimedOut(
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
        const newErr = new errors.ErrorMissingHeader('Missing header');
        await cleanUp(newErr);
        this.dispatchEvent(
          new events.RPCErrorEvent({
            detail: new errors.ErrorRPCOutputStreamError(),
          }),
        );
        return;
      }
      const method = headerMessage.value.method;
      const handler = this.handlerMap.get(method);
      if (handler == null) {
        await cleanUp(new errors.ErrorRPCHandlerFailed('Missing handler'));
        return;
      }
      if (abortController.signal.aborted) {
        await cleanUp(
          new errors.ErrorHandlerAborted('Aborted', {
            cause: new errors.ErrorHandlerAborted(),
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
        let rpcError: JSONRPCError
        if (e instanceof errors.ErrorRPCProtocol) {
          rpcError = e.toJSON();
        }
        else {
          rpcError = new errors.ErrorRPCRemote(e?.message).toJSON();
          (rpcError.data as POJO).cause = JSON.stringify(this.fromError(e), this.replacer);
        }
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
      abortController.abort(new errors.ErrorRPCStreamEnded());
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
