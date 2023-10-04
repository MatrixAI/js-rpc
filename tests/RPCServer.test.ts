import type { ContextTimed } from '@matrixai/contexts';
import type {
  ContainerType,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCResponseError,
  JSONValue,
  RPCStream,
} from '@/types';
import type { RPCErrorEvent } from '@/events';
import type { IdGen } from '@/types';
import { ReadableStream, TransformStream, WritableStream } from 'stream/web';
import { fc, testProp } from '@fast-check/jest';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import RPCServer from '@/RPCServer';
import * as rpcErrors from '@/errors/errors';
import * as rpcUtils from '@/utils';
import { promise, sleep } from '@/utils';
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
      fc.integer({ min: 1, max: 20 }),
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

  testProp(
    'can stream data with raw duplex stream handler',
    [specificMessageArb],
    async (messages) => {
      const stream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(
          rpcTestUtils.binaryStreamToSnippedStream([4, 7, 13, 2, 6]),
        );
      class TestHandler extends RawHandler<ContainerType> {
        public handle = async (
          input: [JSONRPCRequest<JSONValue>, ReadableStream<Uint8Array>],
          cancel: (reason?: any) => void,
          meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): Promise<[JSONValue, ReadableStream<Uint8Array>]> => {
          for await (const _ of input[1]) {
            // No touch, only consume
          }
          const readableStream = new ReadableStream<Uint8Array>({
            start: (controller) => {
              controller.enqueue(Buffer.from('hello world!'));
              controller.close();
            },
          });
          return Promise.resolve([null, readableStream]);
        };
      }

      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestHandler({}),
        },
        logger,
        idGen,
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
    },
    { numRuns: 1 },
  );
  testProp(
    'can stream data with duplex stream handler',
    [specificMessageArb],
    async (messages) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      class TestMethod extends DuplexHandler {
        public handle = async function* (
          input: AsyncGenerator<JSONValue>,
          cancel: (reason?: any) => void,
          meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): AsyncGenerator<JSONValue> {
          for await (const val of input) {
            yield val;
            break;
          }
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
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
    },
  );
  testProp(
    'can stream data with client stream handler',
    [specificMessageArb],
    async (messages) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      class TestMethod extends ClientHandler {
        public handle = async (
          input: AsyncGenerator<JSONValue>,
          cancel: (reason?: any) => void,
          meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): Promise<JSONValue> => {
          let count = 0;
          for await (const _ of input) {
            count += 1;
          }
          return count;
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
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
    },
  );
  testProp(
    'can stream data with server stream handler',
    [singleNumberMessageArb],
    async (messages) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      class TestMethod extends ServerHandler<ContainerType, number, number> {
        public handle = async function* (
          input: number,
        ): AsyncGenerator<number> {
          for (let i = 0; i < input; i++) {
            yield i;
          }
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
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
    },
  );
  testProp(
    'can stream data with server stream handler',
    [specificMessageArb],
    async (messages) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      class TestMethod extends UnaryHandler {
        public handle = async (input: JSONValue): Promise<JSONValue> => {
          return input;
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
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
    },
  );
  testProp(
    'handler is provided with container',
    [specificMessageArb],
    async (messages) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      const container = {
        a: Symbol('a'),
        B: Symbol('b'),
        C: Symbol('c'),
      };
      class TestMethod extends DuplexHandler<typeof container> {
        public handle = async function* (
          input: AsyncGenerator<JSONValue>,
          cancel: (reason?: any) => void,
          meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): AsyncGenerator<JSONValue> {
          expect(this.container).toBe(container);
          for await (const val of input) {
            yield val;
          }
        };
      }

      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod(container),
        },
        logger,
        idGen,
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
    },
  );
  testProp(
    'handler is provided with connectionInfo',
    [specificMessageArb],
    async (messages) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      const meta = {
        localHost: 'hostA',
        localPort: 12341,
        remoteCertificates: [],
        remoteHost: 'hostA',
        remotePort: 12341,
      };
      let handledMeta;
      class TestMethod extends DuplexHandler {
        public handle = async function* (
          input: AsyncGenerator<JSONValue>,
          cancel: (reason?: any) => void,
          meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): AsyncGenerator<JSONValue> {
          handledMeta = meta;
          for await (const val of input) {
            yield val;
          }
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
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
    },
  );
  testProp('handler can be aborted', [specificMessageArb], async (messages) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<JSONValue> {
        for await (const val of input) {
          if (ctx.signal.aborted) throw ctx.signal.reason;
          yield val;
        }
      };
    }
    const rpcServer = await RPCServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
      logger,
      idGen,
    });
    const [outputResult, outputStream] =
      rpcTestUtils.streamToArray<Uint8Array>();
    let thing;
    const tapStream = rpcTestUtils.tapTransformStream<Uint8Array>(
      async (_, iteration) => {
        if (iteration === 2) {
          // @ts-ignore: kidnap private property
          const activeStreams = rpcServer.activeStreams.values();
          // @ts-ignore: kidnap private property
          for (const activeStream of activeStreams) {
            thing = activeStream;
            activeStream.cancel(new rpcErrors.ErrorRPCStopping());
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
    await expect(thing).toResolve();
    expect(lastMessage).toBeDefined();
    expect(() =>
      rpcUtils.parseJSONRPCResponseError(JSON.parse(lastMessage.toString())),
    ).not.toThrow();
    await rpcServer.stop({ force: true });
  });
  testProp('handler yields nothing', [specificMessageArb], async (messages) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<JSONValue> {
        for await (const _ of input) {
          // Do nothing, just consume
        }
      };
    }
    const rpcServer = await RPCServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
      logger,
      idGen,
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
  testProp(
    'should send error message',
    [specificMessageArb, rpcTestUtils.errorArb(rpcTestUtils.errorArb())],
    async (messages, error) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      class TestMethod extends DuplexHandler {
        public handle = async function* (): AsyncGenerator<JSONValue> {
          throw error;
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      let resolve, reject;
      const errorProm = new Promise((resolve_, reject_) => {
        resolve = resolve_;
        reject = reject_;
      });
      rpcServer.addEventListener('error', (thing: RPCErrorEvent) => {
        resolve(thing);
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
      expect(errorMessage.error.message).toEqual(error.description);
      reject();
      await expect(errorProm).toReject();
      await rpcServer.stop({ force: true });
    },
  );
  testProp(
    'should send error message with sensitive',
    [specificMessageArb, rpcTestUtils.errorArb(rpcTestUtils.errorArb())],
    async (messages, error) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      class TestMethod extends DuplexHandler {
        public handle = async function* (): AsyncGenerator<JSONValue> {
          throw error;
        };
      }

      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      let resolve, reject;
      const errorProm = new Promise((resolve_, reject_) => {
        resolve = resolve_;
        reject = reject_;
      });
      rpcServer.addEventListener('error', (thing: RPCErrorEvent) => {
        resolve(thing);
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
      expect(errorMessage.error.message).toEqual(error.description);
      reject();
      await expect(errorProm).toReject();
      await rpcServer.stop({ force: true });
    },
  );
  testProp(
    'should emit stream error if input stream fails',
    [specificMessageArb],
    async (messages) => {
      const handlerEndedProm = promise();
      class TestMethod extends DuplexHandler {
        public handle = async function* (input): AsyncGenerator<JSONValue> {
          try {
            for await (const _ of input) {
              // Consume but don't yield anything
            }
          } finally {
            handlerEndedProm.resolveP();
          }
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      let resolve;
      rpcServer.addEventListener('error', (thing: RPCErrorEvent) => {
        resolve(thing);
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
      const writerReason = Symbol('writerAbort');
      await writer.abort(writerReason);
      // We should get an error RPC message
      await expect(outputResult).toResolve();
      const errorMessage = JSON.parse((await outputResult)[0].toString());
      // Parse without error
      rpcUtils.parseJSONRPCResponseError(errorMessage);
      // Check that the handler was cleaned up.
      await expect(handlerEndedProm.p).toResolve();
      await rpcServer.stop({ force: true });
    },
    { numRuns: 1 },
  );
  testProp(
    'should emit stream error if output stream fails',
    [specificMessageArb],
    async (messages) => {
      const handlerEndedProm = promise();
      let ctx: ContextTimed | undefined;
      class TestMethod extends DuplexHandler {
        public handle = async function* (
          input,
          _cancel,
          _meta,
          ctx_,
        ): AsyncGenerator<JSONValue> {
          ctx = ctx_;
          // Echo input
          try {
            yield* input;
          } finally {
            handlerEndedProm.resolveP();
          }
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      let resolve;
      const errorProm = new Promise<RPCErrorEvent>((resolve_) => {
        resolve = resolve_;
      });
      rpcServer.addEventListener('error', (thing: RPCErrorEvent) => {
        resolve(thing);
      });
      const passThroughStreamIn = new TransformStream<Uint8Array, Uint8Array>();
      const passThroughStreamOut = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
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
      // const writerReason = Symbol('writerAbort');
      const readerReason = Symbol('readerAbort');
      // Await writer.abort(writerReason);
      await reader.cancel(readerReason);
      // We should get an error event
      const event = await errorProm;
      await writer.close();
      // Expect(event.detail.cause).toContain(writerReason);
      expect(event.detail).toBeInstanceOf(rpcErrors.ErrorRPCStreamEnded);
      // Check that the handler was cleaned up.
      await expect(handlerEndedProm.p).toResolve();
      // Check that an abort signal happened
      expect(ctx).toBeDefined();
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBe(readerReason);
      await rpcServer.stop({ force: true });
    },
    { numRuns: 1 },
  );
  testProp('forward middlewares', [specificMessageArb], async (messages) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<JSONValue> {
        yield* input;
      };
    }
    const middlewareFactory = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(
      () => {
        return {
          forward: new TransformStream({
            transform: (chunk, controller) => {
              chunk.params = 1;
              controller.enqueue(chunk);
            },
          }),
          reverse: new TransformStream(),
        };
      },
    );
    const rpcServer = await RPCServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
      middlewareFactory: middlewareFactory,
      logger,
      idGen,
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
      messages.map(() => {
        return JSON.stringify({
          jsonrpc: '2.0',
          result: 1,
          id: null,
        });
      }),
    );
    await rpcServer.stop({ force: true });
  });
  testProp('reverse middlewares', [specificMessageArb], async (messages) => {
    const stream = rpcTestUtils.messagesToReadableStream(messages);
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<JSONValue> {
        yield* input;
      };
    }
    const middleware = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(() => {
      return {
        forward: new TransformStream(),
        reverse: new TransformStream({
          transform: (chunk, controller) => {
            if ('result' in chunk) chunk.result = 1;
            controller.enqueue(chunk);
          },
        }),
      };
    });
    const rpcServer = await RPCServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
      middlewareFactory: middleware,
      logger,
      idGen,
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
      messages.map(() => {
        return JSON.stringify({
          jsonrpc: '2.0',
          result: 1,
          id: null,
        });
      }),
    );
    await rpcServer.stop({ force: true });
  });
  testProp(
    'forward middleware authentication',
    [invalidTokenMessageArb],
    async (message) => {
      const stream = rpcTestUtils.messagesToReadableStream([message]);
      class TestMethod extends DuplexHandler {
        public handle = async function* (
          input: AsyncGenerator<JSONValue>,
          cancel: (reason?: any) => void,
          meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): AsyncGenerator<JSONValue> {
          yield* input;
        };
      }
      const middleware = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(
        () => {
          let first = true;
          let reverseController: TransformStreamDefaultController<JSONRPCResponse>;
          return {
            forward: new TransformStream<
              JSONRPCRequest<TestType>,
              JSONRPCRequest<TestType>
            >({
              transform: (chunk, controller) => {
                if (first && chunk.params?.metadata.token !== validToken) {
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
        },
      );
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        middlewareFactory: middleware,
        logger,
        idGen,
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
      const failureMessage: JSONRPCResponseError = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: 1,
          message: 'failure of some kind',
          type: 'ErrorRPCRemote',
        },
      };
      rpcServer.handleStream(readWriteStream);
      expect((await outputResult).toString()).toEqual(
        JSON.stringify(failureMessage),
      );
      await rpcServer.stop({ force: true });
    },
  );

  test('timeout with default time after handler selected', async () => {
    const ctxProm = promise<ContextTimed>();

    // Diagnostic log to indicate the start of the test

    class TestHandler extends RawHandler<ContainerType> {
      public handle = async (
        _input: [JSONRPCRequest<JSONValue>, ReadableStream<Uint8Array>],
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx_: ContextTimed,
      ): Promise<[JSONValue, ReadableStream<Uint8Array>]> => {
        return new Promise((resolve, reject) => {
          ctxProm.resolveP(ctx_);

          let controller: ReadableStreamController<Uint8Array>;
          const stream = new ReadableStream<Uint8Array>({
            start: (controller_) => {
              controller = controller_;
            },
          });

          ctx_.signal.addEventListener('abort', () => {
            controller!.error(Error('ending'));
          });

          // Return something to fulfill the Promise type expectation.
          resolve([null, stream]);
        });
      };
    }

    const rpcServer = await RPCServer.start({
      manifest: {
        testMethod: new TestHandler({}),
      },
      handlerTimeoutTime: 100,
      logger,
      idGen,
    });

    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const stream = rpcTestUtils.messagesToReadableStream([
      {
        jsonrpc: '2.0',
        method: 'testMethod',
        params: null,
      },
      {
        jsonrpc: '2.0',
        method: 'testMethod',
        params: null,
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
    const rpcServer = await RPCServer.start({
      manifest: {},
      handlerTimeoutTime: 100,
      logger,
      idGen,
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
  test('handler overrides timeout', async () => {
    {
      const waitProm = promise();
      const ctxShortProm = promise<ContextTimed>();
      class TestMethodShortTimeout extends UnaryHandler {
        timeout = 25;
        public handle = async (
          input: JSONValue,
          _cancel,
          _meta,
          ctx_,
        ): Promise<JSONValue> => {
          ctxShortProm.resolveP(ctx_);
          await waitProm.p;
          return input;
        };
      }
      const ctxLongProm = promise<ContextTimed>();
      class TestMethodLongTimeout extends UnaryHandler {
        timeout = 100;
        public handle = async (
          input: JSONValue,
          _cancel,
          _meta,
          ctx_,
        ): Promise<JSONValue> => {
          ctxLongProm.resolveP(ctx_);
          await waitProm.p;
          return input;
        };
      }
      const rpcServer = await RPCServer.start({
        manifest: {
          testShort: new TestMethodShortTimeout({}),
          testLong: new TestMethodLongTimeout({}),
        },
        handlerTimeoutTime: 50,
        logger,
        idGen,
      });
      const streamShort = rpcTestUtils.messagesToReadableStream([
        {
          jsonrpc: '2.0',
          method: 'testShort',
          params: null,
        },
      ]);
      const readWriteStreamShort: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        readable: streamShort,
        writable: new WritableStream(),
      };
      rpcServer.handleStream(readWriteStreamShort);
      // Shorter timeout is updated
      const ctxShort = await ctxShortProm.p;
      expect(ctxShort.timer.delay).toEqual(25);
      const streamLong = rpcTestUtils.messagesToReadableStream([
        {
          jsonrpc: '2.0',
          method: 'testLong',
          params: null,
        },
      ]);
      const readWriteStreamLong: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        readable: streamLong,
        writable: new WritableStream(),
      };
      rpcServer.handleStream(readWriteStreamLong);

      // Longer timeout is set to server's default
      const ctxLong = await ctxLongProm.p;
      expect(ctxLong.timer.delay).toEqual(50);
      waitProm.resolveP();
      await rpcServer.stop({ force: true });
    }
  });
  test('duplex handler refreshes timeout when messages are sent', async () => {
    const contextProm = promise<ContextTimed>();
    const stepProm1 = promise();
    const stepProm2 = promise();
    const passthroughStream = new TransformStream<Uint8Array, Uint8Array>();
    class TestHandler extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<number>,
        cancel: (reason?: any) => void,
        meta: Record<string, number> | undefined,
        ctx: ContextTimed,
      ): AsyncGenerator<number> {
        contextProm.resolveP(ctx);
        for await (const _ of input) {
          // Do nothing, just consume
        }
        await stepProm1.p;
        yield 1;
        await stepProm2.p;
        yield 2;
      };
    }
    const rpcServer = await RPCServer.start({
      manifest: {
        testMethod: new TestHandler({}),
      },
      logger,
      idGen,
      handlerTimeoutTime: 1000,
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
    await writer.write(requestMessage);
    const ctx = await contextProm.p;
    const scheduled: Date | undefined = ctx.timer.scheduled;
    // Checking writing refreshes timer
    await sleep(25);
    await writer.write(requestMessage);
    expect(ctx.timer.scheduled).toBeAfter(scheduled!);
    expect(
      ctx.timer.scheduled!.getTime() - scheduled!.getTime(),
    ).toBeGreaterThanOrEqual(25);
    await writer.close();
    // Checking reading refreshes timer
    await sleep(25);
    stepProm1.resolveP();
    expect(ctx.timer.scheduled).toBeAfter(scheduled!);
    expect(
      ctx.timer.scheduled!.getTime() - scheduled!.getTime(),
    ).toBeGreaterThanOrEqual(25);
    stepProm2.resolveP();
    await outputResult;
    await rpcServer.stop({ force: true });
  });
  test('stream ending cleans up timer and abortSignal', async () => {
    const ctxProm = promise<ContextTimed>();
    class TestHandler extends RawHandler<ContainerType> {
      public handle = async (
        input: [JSONRPCRequest<JSONValue>, ReadableStream<Uint8Array>],
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx_: ContextTimed,
      ): Promise<[JSONValue, ReadableStream<Uint8Array>]> => {
        return new Promise((resolve) => {
          ctxProm.resolveP(ctx_);
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
          resolve([null, readableStream]);
        });
      };
    }
    const rpcServer = await RPCServer.start({
      manifest: {
        testMethod: new TestHandler({}),
      },
      logger,
      idGen,
    });
    const [outputResult, outputStream] = rpcTestUtils.streamToArray();
    const stream = rpcTestUtils.messagesToReadableStream([
      {
        jsonrpc: '2.0',
        method: 'testMethod',
        params: null,
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
  testProp(
    'middleware can update timeout timer',
    [specificMessageArb],
    async (messages) => {
      const stream = rpcTestUtils.messagesToReadableStream(messages);
      const ctxProm = promise<ContextTimed>();
      class TestMethod extends DuplexHandler {
        public handle = async function* (
          input: AsyncGenerator<JSONValue>,
          cancel: (reason?: any) => void,
          meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): AsyncGenerator<JSONValue> {
          ctxProm.resolveP(ctx);
          yield* input;
        };
      }
      const middlewareFactory =
        rpcUtilsMiddleware.defaultServerMiddlewareWrapper((ctx) => {
          ctx.timer.reset(12345);
          return {
            forward: new TransformStream(),
            reverse: new TransformStream(),
          };
        });
      const rpcServer = await RPCServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
        middlewareFactory: middlewareFactory,
        logger,
        idGen,
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
    },
  );
});
