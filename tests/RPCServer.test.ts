import type { ContextTimed } from '@matrixai/contexts';
import type {
  ContainerType,
  JSONRPCRequestParams,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCResponseFailed,
  JSONRPCResponseResult,
  JSONValue,
  RPCStream,
} from '@/types';
import type { IdGen } from '@/types';
import type { PromiseCancellable } from '@matrixai/async-cancellable';
import type * as rpcEvents from '@/events';
import { ReadableStream, TransformStream, WritableStream } from 'stream/web';
import { fc, test } from '@fast-check/jest';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import RPCServer from '@/RPCServer';
import * as rpcErrors from '@/errors';
import * as rpcUtils from '@/utils';
import { promise } from '@/utils';
import * as rpcUtilsMiddleware from '@/middleware';
import ServerHandler from '@/handlers/ServerHandler';
import DuplexHandler from '@/handlers/DuplexHandler';
import RawHandler from '@/handlers/RawHandler';
import UnaryHandler from '@/handlers/UnaryHandler';
import ClientHandler from '@/handlers/ClientHandler';
import * as rpcTestUtils from './utils';

describe(`${RPCServer.name}`, () => {
  const logger = new Logger(`${RPCServer.name} Test`, LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const idGen: IdGen = () => Promise.resolve(null);
  const methodName = 'testMethod';
  const specificMessageArb = fc
    .array(rpcTestUtils.jsonRpcRequestMessageArb(fc.constant(methodName)), {
      minLength: 5,
    })
    .noShrink();
  const singleNumberMessageArb = fc.array(
    rpcTestUtils.jsonRpcRequestMessageArb(
      fc.constant(methodName),
      rpcTestUtils.safeJsonObjectArb,
    ),
    {
      minLength: 2,
      maxLength: 10,
    },
  );
  const validToken = 'VALIDTOKEN';
  const invalidTokenMessageArb = rpcTestUtils.jsonRpcRequestMessageArb(
    fc.constant('testMethod'),
    fc.record({
      metadata: fc.record({
        token: fc.string().filter((v) => v !== validToken),
      }),
      data: rpcTestUtils.safeJsonValueArb,
    }),
  );
  test.prop(
    {
      messages: specificMessageArb,
    },
    { numRuns: 1 },
  )('can stream data with raw duplex stream handler', async ({ messages }) => {
    const stream = rpcTestUtils
      .messagesToReadableStream(messages)
      .pipeThrough(rpcTestUtils.binaryStreamToSnippedStream([4, 7, 13, 2, 6]));
    class TestHandler extends RawHandler<ContainerType> {
      public handle = async (
        input: [JSONRPCRequest, ReadableStream<Uint8Array>],
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): Promise<[JSONRPCResponseResult, ReadableStream<Uint8Array>]> => {
        for await (const _ of input[1]) {
          // No touch, only consume
        }
        const readableStream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(Buffer.from('hello world!'));
            controller.close();
          },
        });
        return Promise.resolve([{}, readableStream]);
      };
    }

    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestHandler({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
  })('can stream data with duplex stream handler', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        // Yield only the first value
        const result = await input.next();
        if (!result.done) yield result.value;
        await input.return(undefined);
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
  })('can stream data with client stream handler', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends ClientHandler {
      public handle = async (
        input: AsyncGenerator<JSONRPCRequestParams<{ value: number }>>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): Promise<JSONRPCResponseResult<{ value: number }>> => {
        let count = 0;
        for await (const _ of input) {
          count += 1;
        }
        return { value: count };
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: singleNumberMessageArb,
  })('can stream data with server stream handler', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends ServerHandler<
      ContainerType,
      JSONRPCRequestParams,
      JSONRPCResponseResult
    > {
      public handle = async function* (
        input: JSONRPCRequestParams,
      ): AsyncGenerator<JSONRPCResponseResult> {
        const number = (input.value as number) ?? 0;
        for (let i = 0; i < number; i++) {
          yield { value: i };
        }
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
  })('can stream data with server stream handler', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends UnaryHandler {
      public handle = async (
        input: JSONRPCRequestParams,
      ): Promise<JSONRPCResponseResult> => {
        return input;
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
  })('handler is provided with container', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    const container = {
      a: Symbol('a'),
      B: Symbol('b'),
      C: Symbol('c'),
    };
    class TestMethod extends DuplexHandler<typeof container> {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        expect(this.container).toBe(container);
        for await (const val of input) {
          yield val;
        }
      };
    }

    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod(container),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
  })('handler is provided with connectionInfo', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    const meta = {
      localHost: 'hostA',
      localPort: 12341,
      remoteCertificates: [],
      remoteHost: 'hostA',
      remotePort: 12341,
    };
    let handledMeta: Record<string, JSONValue> | undefined = undefined;
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        handledMeta = meta;
        for await (const val of input) {
          yield val;
        }
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      meta,
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    await rpcServer.stop({ force: true });
    expect(handledMeta).toBe(meta);
  });
  test.prop({
    messages: specificMessageArb,
  })('handler can be aborted', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        for await (const val of input) {
          if (ctx.signal.aborted) throw ctx.signal.reason;
          yield val;
        }
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] =
      rpcTestUtils.streamToArray<Uint8Array>();
    let activeStream: PromiseCancellable<void> | undefined = undefined;
    const tapStream = rpcTestUtils.tapTransformStream<Uint8Array>(
      async (_, iteration) => {
        if (iteration === 2) {
          // @ts-ignore: kidnap private property
          const activeStreams = rpcServer.activeStreams.values();
          for (const activeStream_ of activeStreams) {
            activeStream = activeStream_;
            activeStream_.cancel(Error('Some error'));
          }
        }
      },
    );
    void tapStream.readable.pipeTo(outputStream).catch(() => {});
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: tapStream.writable,
    };
    rpcServer.handleStream(readWriteStream);
    const result = await outputResult;
    const lastMessage = result[result.length - 1];
    expect(activeStream).toBeDefined();
    await expect(activeStream!).toResolve();
    expect(lastMessage).toBeDefined();
    expect(() =>
      rpcUtils.parseJSONRPCResponseFailed(JSON.parse(lastMessage.toString())),
    ).not.toThrow();
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
  })('handler yields nothing', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        for await (const _ of input) {
          // Do nothing, just consume
        }
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    // We're just expecting no errors
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
    error: rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
  })('should send error message', async ({ messages, error }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle =
        async function* (): AsyncGenerator<JSONRPCResponseResult> {
          throw error;
        };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const {
      p: errorEventP,
      resolveP: resolveErrorEventP,
      rejectP: rejectErrorEventP,
    } = rpcUtils.promise<rpcEvents.RPCErrorEvent>();
    rpcServer.addEventListener('error', (event: rpcEvents.RPCErrorEvent) => {
      resolveErrorEventP(event);
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    const rawErrorMessage = (await outputResult)[0]!.toString();
    const errorMessage = JSON.parse(rawErrorMessage);
    expect(errorMessage.error.message).toEqual(error.message);
    rejectErrorEventP(Error('Never received error event'));
    await expect(errorEventP).toReject();
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
    error: rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
  })(
    'should send error message with sensitive',
    async ({ messages, error }) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      class TestMethod extends DuplexHandler {
        public handle =
          async function* (): AsyncGenerator<JSONRPCResponseResult> {
            throw error;
          };
      }

      const rpcServer = new RPCServer({
        logger,
        idGen,
      });
      await rpcServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
      });
      const {
        p: errorEventP,
        resolveP: resolveErrorEventP,
        rejectP: rejectErrorEventP,
      } = rpcUtils.promise<rpcEvents.RPCErrorEvent>();
      rpcServer.addEventListener('error', (thing: rpcEvents.RPCErrorEvent) => {
        resolveErrorEventP(thing);
      });
      const [outputResult, outputStream] = rpcTestUtils.streamToArray();
      const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        readable: stream,
        writable: outputStream,
      };
      rpcServer.handleStream(readWriteStream);
      const rawErrorMessage = (await outputResult)[0]!.toString();
      const errorMessage = JSON.parse(rawErrorMessage);
      expect(errorMessage.error.message).toEqual(error.message);
      rejectErrorEventP(Error('Never received error event'));
      await expect(errorEventP).toReject();
      await rpcServer.stop({ force: true });
    },
  );
  test.prop(
    {
      messages: specificMessageArb,
    },
    { numRuns: 1 },
  )('should emit stream error if input stream fails', async ({ messages }) => {
    const handlerEndedProm = promise();
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
      ): AsyncGenerator<JSONRPCResponseResult> {
        try {
          for await (const _ of input) {
            // Consume but don't yield anything
          }
        } finally {
          handlerEndedProm.resolveP();
        }
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const passThroughStreamIn = new TransformStream<Uint8Array, Uint8Array>();
    const [outputResult, outputStream] = rpcTestUtils.streamToArray<Buffer>();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: passThroughStreamIn.readable,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    const writer = passThroughStreamIn.writable.getWriter();
    // Write messages
    for (const message of messages) {
      await writer.write(Buffer.from(JSON.stringify(message)));
    }
    // Abort stream
    const writerReason = new Error('writerAbort');
    await writer.abort(writerReason);
    // We should get an error RPC message
    await expect(outputResult).toResolve();
    const errorMessage = JSON.parse((await outputResult)[0].toString());
    // Parse without error
    rpcUtils.parseJSONRPCResponseFailed(errorMessage);
    // Check that the handler was cleaned up.
    await expect(handlerEndedProm.p).toResolve();
    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      messages: specificMessageArb,
    },
    { numRuns: 1 },
  )('should emit stream error if output stream fails', async ({ messages }) => {
    const handlerEndedProm = promise();
    const ctxProm = promise<ContextTimed>();
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        ctxProm.resolveP(ctx);
        // Echo input
        try {
          yield* input;
        } finally {
          handlerEndedProm.resolveP();
        }
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const { p: errorEventP, resolveP: resolveErrorEventP } =
      rpcUtils.promise<rpcEvents.RPCErrorEvent>();
    rpcServer.addEventListener(
      'error',
      (rpcErrorEvent: rpcEvents.RPCErrorEvent) => {
        resolveErrorEventP(rpcErrorEvent);
      },
    );
    const passThroughStreamIn = new TransformStream<Uint8Array, Uint8Array>();
    const passThroughStreamOut = new TransformStream<Uint8Array, Uint8Array>();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: passThroughStreamIn.readable,
      writable: passThroughStreamOut.writable,
    };
    rpcServer.handleStream(readWriteStream);
    const writer = passThroughStreamIn.writable.getWriter();
    const reader = passThroughStreamOut.readable.getReader();
    // Write messages
    for (const message of messages) {
      await writer.write(Buffer.from(JSON.stringify(message)));
      await reader.read();
    }
    // Abort stream
    const readerReason = Symbol('readerAbort');
    await reader.cancel(readerReason);
    // We should get an error event
    const event = await errorEventP;
    await writer.close();
    expect(event.detail).toBeInstanceOf(rpcErrors.ErrorRPCStreamEnded);
    // Check that the handler was cleaned up.
    await expect(handlerEndedProm.p).toResolve();
    // Check that an abort signal happened
    const ctx = await ctxProm.p;
    expect(ctx.signal.aborted).toBeTrue();
    expect(ctx.signal.reason).toBe(readerReason);
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
  })('forward middlewares', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        yield* input;
      };
    }
    const middlewareFactory = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(
      () => {
        return {
          forward: new TransformStream({
            transform: (chunk, controller) => {
              chunk.params = { value: 1 };
              controller.enqueue(chunk);
            },
          }),
          reverse: new TransformStream(),
        };
      },
    );
    const rpcServer = new RPCServer({
      middlewareFactory: middlewareFactory,
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    const out = await outputResult;
    expect(out.map((v) => v!.toString())).toStrictEqual(
      messages.map(() =>
        JSON.stringify({
          jsonrpc: '2.0',
          result: { value: 1 },
          id: null,
        }),
      ),
    );
    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      messages: specificMessageArb,
    },
    { numRuns: 1 },
  )('reverse middlewares', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams<{ value: number }>>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult<{ value: number }>> {
        yield* input;
      };
    }
    const middleware = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(() => {
      return {
        forward: new TransformStream(),
        reverse: new TransformStream({
          transform: (chunk, controller) => {
            if ('result' in chunk) chunk.result = { value: 1 };
            controller.enqueue(chunk);
          },
        }),
      };
    });
    const rpcServer = new RPCServer({
      middlewareFactory: middleware,
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    const out = await outputResult;
    expect(out.map((v) => v!.toString())).toStrictEqual(
      messages.map(() =>
        JSON.stringify({
          jsonrpc: '2.0',
          result: { value: 1 },
          id: null,
        }),
      ),
    );
    await rpcServer.stop({ force: true });
  });
  test.prop({
    message: invalidTokenMessageArb,
  })('forward middleware authentication', async ({ message }) => {
    const stream = rpcTestUtils.messagesToReadableStream([message]);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        yield* input;
      };
    }
    const middleware = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(() => {
      let first = true;
      let reverseController: TransformStreamDefaultController<JSONRPCResponse>;
      return {
        forward: new TransformStream<
          JSONRPCRequest<TestType>,
          JSONRPCRequest<TestType>
        >({
          transform: (chunk, controller) => {
            if (first && chunk.params?.metadata?.token !== validToken) {
              reverseController.enqueue(failureMessage);
              // Closing streams early
              controller.terminate();
              reverseController.terminate();
            }
            first = false;
            controller.enqueue(chunk);
          },
        }),
        reverse: new TransformStream({
          start: (controller) => {
            // Kidnapping reverse controller
            reverseController = controller;
          },
          transform: (chunk, controller) => {
            controller.enqueue(chunk);
          },
        }),
      };
    });
    const rpcServer = new RPCServer({
      middlewareFactory: middleware,
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    type TestType = {
      metadata: {
        token: string;
      };
      data: JSONValue;
    };
    const failureMessage: JSONRPCResponseFailed = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: 1,
        message: 'failure of some kind',
      },
    };
    rpcServer.handleStream(readWriteStream);
    expect((await outputResult).toString()).toEqual(
      JSON.stringify(failureMessage),
    );
    await rpcServer.stop({ force: true });
  });
  test.prop({
    timeoutTime: fc.integer({ max: -1 }),
  })(
    'constructor should throw when passed a negative timeout',
    async ({ timeoutTime }) => {
      const constructorF = () =>
        new RPCServer({
          timeoutTime,
          logger,
          idGen,
        });

      expect(constructorF).toThrow(rpcErrors.ErrorRPCInvalidTimeout);
    },
  );
  test.prop({
    timeoutTime: fc.integer({ max: -1 }),
  })(
    'start should throw when passed a handler with negative timeout',
    async ({ timeoutTime }) => {
      const waitProm = promise();
      const ctxLongProm = promise<ContextTimed>();

      class TestMethodArbitraryTimeout extends UnaryHandler {
        timeout = timeoutTime;
        public handle = async (
          input: JSONRPCRequestParams,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): Promise<JSONRPCResponseResult> => {
          ctxLongProm.resolveP(ctx);
          await waitProm.p;
          return input;
        };
      }
      const rpcServer = new RPCServer({
        logger,
        idGen,
      });

      await expect(
        rpcServer.start({
          manifest: {
            testArbitrary: new TestMethodArbitraryTimeout({}),
          },
        }),
      ).rejects.toBeInstanceOf(rpcErrors.ErrorRPCInvalidHandlerTimeout);
    },
  );
  test('timeout with default time after handler selected', async () => {
    const ctxProm = promise<ContextTimed>();

    // Diagnostic log to indicate the start of the test

    class TestHandler extends RawHandler<ContainerType> {
      public handle = async (
        _input: [JSONRPCRequest, ReadableStream<Uint8Array>],
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): Promise<[JSONRPCResponseResult, ReadableStream<Uint8Array>]> => {
        return new Promise((resolve) => {
          ctxProm.resolveP(ctx);

          let controller: ReadableStreamController<Uint8Array>;
          const stream = new ReadableStream<Uint8Array>({
            start: (controller_) => {
              controller = controller_;
            },
          });

          ctx.signal.addEventListener('abort', () => {
            controller!.error(Error('ending'));
          });

          // Return something to fulfill the Promise type expectation.
          resolve([{}, stream]);
        });
      };
    }
    const rpcServer = new RPCServer({
      timeoutTime: 100,
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestHandler({}),
      },
    });

    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const stream = rpcTestUtils.messagesToReadableStream([
      {
        jsonrpc: '2.0',
        method: 'testMethod',
        params: {},
      },
      {
        jsonrpc: '2.0',
        method: 'testMethod',
        params: {},
      },
    ]);

    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    const ctx = await ctxProm.p;
    expect(ctx.timer.delay).toEqual(100);
    await ctx.timer;
    expect(ctx.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    await expect(outputResult).toReject();

    await rpcServer.stop({ force: true });
  });
  test('timeout with default time before handler selected', async () => {
    const rpcServer = new RPCServer({
      timeoutTime: 100,
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {},
    });
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: new ReadableStream({
        // Ignore
        cancel: () => {},
      }),
      writable: new WritableStream({
        // Ignore
        abort: () => {},
      }),
    };
    rpcServer.handleStream(readWriteStream);
    // With no handler we can only check alive connections through the server
    // @ts-ignore: kidnap protected property
    const activeStreams = rpcServer.activeStreams;
    for await (const [prom] of activeStreams.entries()) {
      await prom;
    }
    await rpcServer.stop({ force: true });
  });
  test('duplex handler cancels timeout when messages are sent', async () => {
    const contextProm = promise<ContextTimed>();
    const passthroughStream = new TransformStream<Uint8Array, Uint8Array>();
    class TestHandler extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams<{ value: number }>>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, number> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult<{ value: number }>> {
        contextProm.resolveP(ctx);
        for await (const _ of input) {
          // Do nothing
        }
        yield { value: 1 };
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
      timeoutTime: 1000,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestHandler({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const requestMessage = Buffer.from(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'testMethod',
        params: 1,
      }),
    );
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: passthroughStream.readable,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    const writer = passthroughStream.writable.getWriter();
    // Send request for method
    await writer.write(requestMessage);
    const ctx = await contextProm.p;
    // Send data
    await writer.write(requestMessage);
    await writer.close();
    await outputResult;
    await expect(ctx.timer).rejects.toBe(rpcUtils.timeoutCancelledReason);
    await rpcServer.stop({ force: true });
  });
  test('stream ending cleans up timer and abortSignal', async () => {
    const ctxProm = promise<ContextTimed>();
    class TestHandler extends RawHandler<ContainerType> {
      public handle = async (
        input: [JSONRPCRequest, ReadableStream<Uint8Array>],
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): Promise<[JSONRPCResponseResult, ReadableStream<Uint8Array>]> => {
        return new Promise((resolve) => {
          ctxProm.resolveP(ctx);
          void (async () => {
            for await (const _ of input[1]) {
              // Do nothing, just consume
            }
          })();
          const readableStream = new ReadableStream<Uint8Array>({
            start: (controller) => {
              controller.close();
            },
          });
          resolve([{}, readableStream]);
        });
      };
    }
    const rpcServer = new RPCServer({
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestHandler({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const stream = rpcTestUtils.messagesToReadableStream([
      {
        jsonrpc: '2.0',
        method: 'testMethod',
        params: {},
      },
    ]);
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    const ctx = await ctxProm.p;
    await outputResult;
    await rpcServer.stop({ force: false });
    expect(ctx.signal.aborted).toBeTrue();
    expect(ctx.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCStreamEnded);
    // If the timer has already resolved then it was cancelled
    await expect(ctx.timer).toReject();
    await rpcServer.stop({ force: true });
  });
  test.prop({
    messages: specificMessageArb,
  })('middleware can update timeout timer', async ({ messages }) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    const ctxProm = promise<ContextTimed>();
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONRPCRequestParams>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<JSONRPCResponseResult> {
        ctxProm.resolveP(ctx);
        yield* input;
      };
    }
    const middlewareFactory = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(
      (ctx) => {
        ctx.timer.reset(12345);
        return {
          forward: new TransformStream(),
          reverse: new TransformStream(),
        };
      },
    );
    const rpcServer = new RPCServer({
      middlewareFactory: middlewareFactory,
      logger,
      idGen,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      readable: stream,
      writable: outputStream,
    };
    rpcServer.handleStream(readWriteStream);
    await outputResult;
    const ctx = await ctxProm.p;
    expect(ctx.timer.delay).toBe(12345);
  });
  describe('timeout priority', () => {
    test.prop({
      messages: specificMessageArb,
      timeouts: rpcTestUtils.timeoutsArb,
    })(
      'check that handler can override higher timeout of RPCServer',
      async ({ messages, timeouts: [lowerTimeoutTime, higherTimeoutTime] }) => {
        const stream = rpcTestUtils.messagesToReadableStream(messages);
        const { p: ctxP, resolveP: resolveCtxP } = promise<ContextTimed>();
        class TestMethod extends DuplexHandler {
          public timeout = lowerTimeoutTime;
          public handle = async function* (
            input: AsyncGenerator<JSONRPCRequestParams>,
            _cancel: (reason?: any) => void,
            _meta: Record<string, JSONValue> | undefined,
            ctx: ContextTimed,
          ): AsyncGenerator<JSONRPCResponseResult> {
            resolveCtxP(ctx);
            yield* input;
          };
        }
        const rpcServer = new RPCServer({
          logger,
          timeoutTime: higherTimeoutTime,
          idGen,
        });
        await rpcServer.start({
          manifest: {
            testMethod: new TestMethod({}),
          },
        });
        const [outputResult, outputStream] = rpcTestUtils.streamToArray();
        const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
          cancel: () => {},
          readable: stream,
          writable: outputStream,
        };
        rpcServer.handleStream(readWriteStream);
        await outputResult;
        const ctx = await ctxP;
        expect(ctx.timer.delay).toBe(lowerTimeoutTime);
        ctx.timer.cancel();
        await ctx.timer.catch(() => {});
      },
    );
    test.prop({
      messages: specificMessageArb,
      timeouts: rpcTestUtils.timeoutsArb,
    })(
      'check that handler can override lower timeout of RPCServer',
      async ({ messages, timeouts: [lowerTimeoutTime, higherTimeoutTime] }) => {
        const stream = rpcTestUtils.messagesToReadableStream(messages);
        const { p: ctxP, resolveP: resolveCtxP } = promise<ContextTimed>();
        class TestMethod extends DuplexHandler {
          public timeout = higherTimeoutTime;
          public handle = async function* (
            input: AsyncGenerator<JSONRPCRequestParams>,
            _cancel: (reason?: any) => void,
            _meta: Record<string, JSONValue> | undefined,
            ctx: ContextTimed,
          ): AsyncGenerator<JSONRPCResponseResult> {
            resolveCtxP(ctx);
            yield* input;
          };
        }
        const rpcServer = new RPCServer({
          logger,
          timeoutTime: lowerTimeoutTime,
          idGen,
        });
        await rpcServer.start({
          manifest: {
            testMethod: new TestMethod({}),
          },
        });
        const [outputResult, outputStream] = rpcTestUtils.streamToArray();
        const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
          cancel: () => {},
          readable: stream,
          writable: outputStream,
        };
        rpcServer.handleStream(readWriteStream);
        await outputResult;
        const ctx = await ctxP;
        expect(ctx.timer.delay).toBe(higherTimeoutTime);
        ctx.timer.cancel();
        await ctx.timer.catch(() => {});
      },
    );
  });
  test.prop({
    messages: specificMessageArb,
    timeoutTime: fc.integer({ min: 0 }),
  })(
    'check that handler can override lower timeout of RPCServer with Infinity',
    async ({ messages, timeoutTime }) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      const { p: ctxP, resolveP: resolveCtxP } = promise<ContextTimed>();
      class TestMethod extends DuplexHandler {
        public timeout = Infinity;
        public handle = async function* (
          input: AsyncGenerator<JSONRPCRequestParams>,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): AsyncGenerator<JSONRPCResponseResult> {
          resolveCtxP(ctx);
          yield* input;
        };
      }
      const rpcServer = new RPCServer({
        logger,
        timeoutTime,
        idGen,
      });
      await rpcServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
      });
      const [outputResult, outputStream] = rpcTestUtils.streamToArray();
      const readWriteStream: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        readable: stream,
        writable: outputStream,
      };
      rpcServer.handleStream(readWriteStream);
      await outputResult;
      const ctx = await ctxP;
      expect(ctx.timer.delay).toBe(Infinity);
      ctx.timer.cancel();
      await ctx.timer.catch(() => {});
    },
  );
});
