import type { ContextTimed } from '@matrixai/contexts';
import type { JSONRPCParams, JSONRPCResult, JSONValue } from '@/types';
import type {
  JSONRPCRequest,
  JSONRPCRequestMessage,
  JSONRPCResponse,
  JSONRPCResponseResult,
  RPCStream,
} from '@/types';
import type { IdGen } from '@/types';
import { TransformStream, ReadableStream } from 'stream/web';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { Timer } from '@matrixai/timer';
import { testProp, fc } from '@fast-check/jest';
import RawCaller from '@/callers/RawCaller';
import DuplexCaller from '@/callers/DuplexCaller';
import ServerCaller from '@/callers/ServerCaller';
import ClientCaller from '@/callers/ClientCaller';
import UnaryCaller from '@/callers/UnaryCaller';
import RPCClient from '@/RPCClient';
import RPCServer from '@/RPCServer';
import * as rpcErrors from '@/errors';
import * as rpcUtilsMiddleware from '@/middleware';
import { promise, timeoutCancelledReason } from '@/utils';
import * as rpcTestUtils from './utils';

describe(`${RPCClient.name}`, () => {
  const logger = new Logger(`${RPCServer.name} Test`, LogLevel.WARN, [
    new StreamHandler(),
  ]);
  const idGen: IdGen = () => Promise.resolve(null);

  const methodName = 'testMethod';
  const specificMessageArb = fc
    .array(rpcTestUtils.jsonRpcResponseResultArb(), {
      minLength: 5,
    })
    .noShrink();

  testProp(
    'raw caller',
    [
      rpcTestUtils.safeJsonObjectArb,
      rpcTestUtils.rawDataArb,
      rpcTestUtils.rawDataArb,
    ],
    async (headerParams, inputData, outputData) => {
      const [inputResult, inputWritableStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const [outputResult, outputWritableStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: new ReadableStream<Uint8Array>({
          start: (controller) => {
            const leadingResponse: JSONRPCResponseResult = {
              jsonrpc: '2.0',
              result: {},
              id: null,
            };
            controller.enqueue(Buffer.from(JSON.stringify(leadingResponse)));
            for (const datum of outputData) {
              controller.enqueue(datum);
            }
            controller.close();
          },
        }),
        writable: inputWritableStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const callerInterface = await rpcClient.rawStreamCaller(
        'testMethod',
        headerParams,
      );
      await callerInterface.readable.pipeTo(outputWritableStream);
      const writer = callerInterface.writable.getWriter();
      for (const inputDatum of inputData) {
        await writer.write(inputDatum);
      }
      await writer.close();

      const expectedHeader: JSONRPCRequest = {
        jsonrpc: '2.0',
        method: methodName,
        params: headerParams,
        id: null,
      };
      expect(await inputResult).toStrictEqual([
        Buffer.from(JSON.stringify(expectedHeader)),
        ...inputData,
      ]);
      expect(await outputResult).toStrictEqual(outputData);
    },
  );
  testProp('generic duplex caller', [specificMessageArb], async (messages) => {
    const inputStream = rpcTestUtils.messagesToReadableStream(messages);
    const [outputResult, outputStream] =
      rpcTestUtils.streamToArray<Uint8Array>();
    const streamPair: RPCStream<Uint8Array, Uint8Array> = {
      cancel: () => {},
      meta: undefined,
      readable: inputStream,
      writable: outputStream,
    };
    const rpcClient = new RPCClient({
      manifest: {},
      streamFactory: async () => streamPair,
      logger,
      idGen,
    });
    const callerInterface = await rpcClient.duplexStreamCaller<
      JSONRPCParams,
      JSONRPCResult
    >(methodName);
    const writable = callerInterface.writable.getWriter();
    for await (const value of callerInterface.readable) {
      await writable.write(value);
    }
    await writable.close();

    const expectedMessages: Array<JSONRPCRequestMessage> = messages.map(
      (v, i) => ({
        jsonrpc: '2.0',
        method: methodName,
        id: null,
        params: {
          ...v.result,
          ...(i === 0 ? { metadata: { timeout: null } } : {}),
        },
      }),
    );

    const outputMessages = (await outputResult).map((v) =>
      JSON.parse(v.toString()),
    );

    expect(outputMessages).toStrictEqual(expectedMessages);
  });
  testProp(
    'generic server stream caller',
    [specificMessageArb, rpcTestUtils.safeJsonObjectArb],
    async (messages, params) => {
      const inputStream = rpcTestUtils.messagesToReadableStream(messages);
      const [outputResult, outputStream] = rpcTestUtils.streamToArray();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const callerInterface = await rpcClient.serverStreamCaller<
        JSONRPCParams,
        JSONRPCResult
      >(methodName, params);
      const values: Array<JSONValue> = [];
      for await (const value of callerInterface) {
        values.push(value);
      }
      const expectedValues = messages.map((v) => v.result);
      expect(values).toStrictEqual(expectedValues);
      expect((await outputResult)[0]?.toString()).toStrictEqual(
        JSON.stringify({
          method: methodName,
          jsonrpc: '2.0',
          id: null,
          params: {
            ...params,
            metadata: {
              timeout: null,
            },
          },
        }),
      );
    },
  );
  testProp(
    'generic client stream caller',
    [
      rpcTestUtils.jsonRpcResponseResultArb(),
      fc.array(rpcTestUtils.safeJsonObjectArb),
    ],
    async (message, params) => {
      const inputStream = rpcTestUtils.messagesToReadableStream([message]);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const { output, writable } = await rpcClient.clientStreamCaller<
        JSONRPCParams,
        JSONRPCResult
      >(methodName);
      const writer = writable.getWriter();
      for (const param of params) {
        await writer.write(param);
      }
      await writer.close();
      expect(await output).toStrictEqual(message.result);
      const expectedOutput = params.map((v, i) =>
        JSON.stringify({
          method: methodName,
          jsonrpc: '2.0',
          id: null,
          params: { ...v, ...(i === 0 ? { metadata: { timeout: null } } : {}) },
        }),
      );

      expect((await outputResult).map((v) => v.toString())).toStrictEqual(
        expectedOutput,
      );
    },
  );
  testProp(
    'generic unary caller',
    [rpcTestUtils.jsonRpcResponseResultArb(), rpcTestUtils.safeJsonObjectArb],
    async (message, params) => {
      const inputStream = rpcTestUtils.messagesToReadableStream([message]);
      const [outputResult, outputStream] = rpcTestUtils.streamToArray();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const result = await rpcClient.unaryCaller<JSONRPCParams, JSONRPCResult>(
        methodName,
        params,
      );
      expect(result).toStrictEqual(message.result);
      expect((await outputResult)[0]?.toString()).toStrictEqual(
        JSON.stringify({
          method: methodName,
          jsonrpc: '2.0',
          id: null,
          params: { ...params, metadata: { timeout: null } },
        }),
      );
    },
  );
  testProp(
    'generic duplex caller can throw received error message',
    [
      fc.array(rpcTestUtils.jsonRpcResponseResultArb()),
      rpcTestUtils.jsonRpcResponseErrorArb(rpcTestUtils.errorArb()),
    ],
    async (messages, errorMessage) => {
      const inputStream = rpcTestUtils.messagesToReadableStream([
        ...messages,
        errorMessage,
      ]);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const callerInterface = await rpcClient.duplexStreamCaller<
        JSONRPCParams,
        JSONRPCResult
      >(methodName);
      await callerInterface.writable.close();
      const callProm = (async () => {
        for await (const _ of callerInterface.readable) {
          // Only consume
        }
      })();
      await expect(callProm).rejects.toThrow(rpcErrors.ErrorRPCRemote);
      await outputResult;
    },
  );
  testProp(
    'generic duplex caller can throw received error message with sensitive',
    [
      fc.array(rpcTestUtils.jsonRpcResponseResultArb()),
      rpcTestUtils.jsonRpcResponseErrorArb(rpcTestUtils.errorArb()),
    ],
    async (messages, errorMessage) => {
      const inputStream = rpcTestUtils.messagesToReadableStream([
        ...messages,
        errorMessage,
      ]);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const callerInterface = await rpcClient.duplexStreamCaller<
        JSONRPCParams,
        JSONRPCResult
      >(methodName);
      await callerInterface.writable.close();
      const callProm = (async () => {
        for await (const _ of callerInterface.readable) {
          // Only consume
        }
      })();
      await expect(callProm).rejects.toThrow(rpcErrors.ErrorRPCRemote);
      await outputResult;
    },
  );
  testProp(
    'generic duplex caller can throw received error message with causes',
    [
      fc.array(rpcTestUtils.jsonRpcResponseResultArb()),
      rpcTestUtils.jsonRpcResponseErrorArb(
        rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
      ),
    ],
    async (messages, errorMessage) => {
      const inputStream = rpcTestUtils.messagesToReadableStream([
        ...messages,
        errorMessage,
      ]);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const callerInterface = await rpcClient.duplexStreamCaller<
        JSONRPCParams,
        JSONRPCResult
      >(methodName);
      await callerInterface.writable.close();
      const callProm = (async () => {
        for await (const _ of callerInterface.readable) {
          // Only consume
        }
      })();
      await expect(callProm).rejects.toThrow(rpcErrors.ErrorRPCRemote);
      await outputResult;
    },
  );
  testProp(
    'generic duplex caller with forward Middleware',
    [specificMessageArb],
    async (messages) => {
      const inputStream = rpcTestUtils.messagesToReadableStream(messages);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        middlewareFactory: rpcUtilsMiddleware.defaultClientMiddlewareWrapper(
          () => {
            return {
              forward: new TransformStream<JSONRPCRequest, JSONRPCRequest>({
                transform: (chunk, controller) => {
                  controller.enqueue({
                    ...chunk,
                    params: { value: 'one', metadata: chunk.params?.metadata },
                  });
                },
              }),
              reverse: new TransformStream(),
            };
          },
        ),
        logger,
        idGen,
      });

      const callerInterface = await rpcClient.duplexStreamCaller<
        JSONRPCParams,
        JSONRPCResult
      >(methodName);
      const reader = callerInterface.readable.getReader();
      const writer = callerInterface.writable.getWriter();
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // We have to end the writer otherwise the stream never closes
          await writer.close();
          break;
        }
        await writer.write(value);
      }

      const expectedMessages: Array<JSONRPCRequestMessage> = messages.map(
        (_, i) => ({
          jsonrpc: '2.0',
          method: methodName,
          id: null,
          params: {
            value: 'one',
            ...(i === 0 ? { metadata: { timeout: null } } : {}),
          },
        }),
      );

      const outputMessages = (await outputResult).map((v) =>
        JSON.parse(v.toString()),
      );
      expect(outputMessages).toStrictEqual(expectedMessages);
    },
  );
  testProp(
    'generic duplex caller with reverse Middleware',
    [specificMessageArb],
    async (messages) => {
      const inputStream = rpcTestUtils.messagesToReadableStream(messages);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async () => streamPair,
        middlewareFactory: rpcUtilsMiddleware.defaultClientMiddlewareWrapper(
          () => {
            return {
              forward: new TransformStream(),
              reverse: new TransformStream<JSONRPCResponse, JSONRPCResponse>({
                transform: (chunk, controller) => {
                  controller.enqueue({
                    ...chunk,
                    result: { value: 'one' },
                  });
                },
              }),
            };
          },
        ),
        logger,
        idGen,
      });

      const callerInterface = await rpcClient.duplexStreamCaller<
        JSONRPCParams,
        JSONRPCResult
      >(methodName);
      const reader = callerInterface.readable.getReader();
      const writer = callerInterface.writable.getWriter();
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // We have to end the writer otherwise the stream never closes
          await writer.close();
          break;
        }
        expect(value).toStrictEqual({ value: 'one' });
        await writer.write(value);
      }
      await outputResult;
    },
  );
  testProp(
    'manifest server call',
    [specificMessageArb, fc.string()],
    async (messages, params) => {
      const inputStream = rpcTestUtils.messagesToReadableStream(messages);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {
          server: new ServerCaller<JSONRPCParams, JSONRPCResult>(),
        },
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const callerInterface = await rpcClient.methods.server({ value: params });
      const values: Array<JSONValue> = [];
      for await (const value of callerInterface) {
        values.push(value);
      }
      const expectedValues = messages.map((v) => v.result);
      expect(values).toStrictEqual(expectedValues);
      expect((await outputResult)[0]?.toString()).toStrictEqual(
        JSON.stringify({
          method: 'server',
          jsonrpc: '2.0',
          id: null,
          params: { value: params, metadata: { timeout: null } },
        }),
      );
    },
  );
  testProp(
    'manifest client call',
    [
      rpcTestUtils.jsonRpcResponseResultArb(rpcTestUtils.safeJsonObjectArb),
      fc.array(fc.string(), { minLength: 5 }),
    ],
    async (message, params) => {
      const inputStream = rpcTestUtils.messagesToReadableStream([message]);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {
          client: new ClientCaller<JSONRPCParams, JSONRPCResult>(),
        },
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const { output, writable } = await rpcClient.methods.client();
      const writer = writable.getWriter();
      for (const param of params) {
        await writer.write({ value: param });
      }
      expect(await output).toStrictEqual(message.result);
      await writer.close();
      const expectedOutput = params.map((v, i) =>
        JSON.stringify({
          method: 'client',
          jsonrpc: '2.0',
          id: null,
          params: {
            value: v,
            ...(i === 0 ? { metadata: { timeout: null } } : {}),
          },
        }),
      );
      expect((await outputResult).map((v) => v.toString())).toStrictEqual(
        expectedOutput,
      );
    },
  );
  testProp(
    'manifest unary call',
    [rpcTestUtils.jsonRpcResponseResultArb().noShrink(), fc.string()],
    async (message, params) => {
      const inputStream = rpcTestUtils.messagesToReadableStream([message]);
      const [outputResult, outputStream] = rpcTestUtils.streamToArray();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {
          unary: new UnaryCaller<JSONRPCParams, JSONRPCResult>(),
        },
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const result = await rpcClient.methods.unary({ value: params });
      expect(result).toStrictEqual(message.result);
      expect((await outputResult)[0]?.toString()).toStrictEqual(
        JSON.stringify({
          method: 'unary',
          jsonrpc: '2.0',
          id: null,
          params: { value: params, metadata: { timeout: null } },
        }),
      );
    },
  );
  testProp(
    'manifest raw caller',
    [
      rpcTestUtils.safeJsonObjectArb,
      rpcTestUtils.rawDataArb,
      rpcTestUtils.rawDataArb,
    ],
    async (headerParams, inputData, outputData) => {
      const [inputResult, inputWritableStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const [outputResult, outputWritableStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: new ReadableStream<Uint8Array>({
          start: (controller) => {
            const leadingResponse: JSONRPCResponseResult = {
              jsonrpc: '2.0',
              result: { value: null },
              id: null,
            };
            controller.enqueue(Buffer.from(JSON.stringify(leadingResponse)));
            for (const datum of outputData) {
              controller.enqueue(datum);
            }
            controller.close();
          },
        }),
        writable: inputWritableStream,
      };
      const rpcClient = new RPCClient({
        manifest: {
          raw: new RawCaller(),
        },
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      const callerInterface = await rpcClient.methods.raw(headerParams);
      await callerInterface.readable.pipeTo(outputWritableStream);
      const writer = callerInterface.writable.getWriter();
      for (const inputDatum of inputData) {
        await writer.write(inputDatum);
      }
      await writer.close();

      const expectedHeader: JSONRPCRequest = {
        jsonrpc: '2.0',
        method: 'raw',
        params: headerParams,
        id: null,
      };
      expect(await inputResult).toStrictEqual([
        Buffer.from(JSON.stringify(expectedHeader)),
        ...inputData,
      ]);
      expect(await outputResult).toStrictEqual(outputData);
    },
    { seed: -783452149, path: '0:0:0:0:0:0:0', endOnFailure: true },
  );
  testProp(
    'manifest duplex caller',
    [
      fc.array(
        rpcTestUtils.jsonRpcResponseResultArb(rpcTestUtils.safeJsonObjectArb),
        {
          minLength: 1,
        },
      ),
    ],
    async (messages) => {
      const inputStream = rpcTestUtils.messagesToReadableStream(messages);
      const [outputResult, outputStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: outputStream,
      };
      const rpcClient = new RPCClient({
        manifest: {
          duplex: new DuplexCaller<JSONRPCParams, JSONRPCResponse>(),
        },
        streamFactory: async () => streamPair,
        logger,
        idGen,
      });
      let count = 0;
      const callerInterface = await rpcClient.methods.duplex();
      const writer = callerInterface.writable.getWriter();
      for await (const value of callerInterface.readable) {
        count += 1;
        await writer.write(value);
      }
      await writer.close();
      const result = await outputResult;
      // We're just checking that it's consuming the messages as expected
      expect(result.length).toEqual(messages.length);
      expect(count).toEqual(messages.length);
    },
  );
  test('manifest without handler errors', async () => {
    const rpcClient = new RPCClient({
      manifest: {},
      streamFactory: async () => {
        return {} as RPCStream<Uint8Array, Uint8Array>;
      },
      logger,
      idGen,
    });
    // @ts-ignore: ignoring type safety here
    expect(() => rpcClient.methods.someMethod()).toThrow();
    // @ts-ignore: ignoring type safety here
    expect(() => rpcClient.withMethods.someMethod()).toThrow();
  });
  testProp(
    'constructor should throw when passed a negative timeoutTime',
    [fc.integer({ max: -1 })],
    async (timeoutTime) => {
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: new ReadableStream(),
        writable: new WritableStream(),
      };
      const constructorF = () =>
        new RPCClient({
          timeoutTime,
          streamFactory: () => Promise.resolve(streamPair),
          manifest: {},
          logger,
          idGen,
        });

      expect(constructorF).toThrowError(rpcErrors.ErrorRPCInvalidTimeout);
    },
  );
  describe('raw caller', () => {
    test('raw caller uses default timeout when creating stream', async () => {
      const holdProm = promise();
      let ctx: ContextTimed | undefined;
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctx = ctx_;
          await holdProm.p;
          // Should never reach this when testing
          return {} as RPCStream<Uint8Array, Uint8Array>;
        },
        timeoutTime: 100,
        logger,
        idGen,
      });
      // Timing out on stream creation
      const callerInterfaceProm = rpcClient.rawStreamCaller('testMethod', {});
      await expect(callerInterfaceProm).toReject();
      await expect(callerInterfaceProm).rejects.toThrow(
        rpcErrors.ErrorRPCTimedOut,
      );
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    });
    test('raw caller times out when creating stream', async () => {
      const holdProm = promise();
      let ctx: ContextTimed | undefined;
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctx = ctx_;
          await holdProm.p;
          // Should never reach this when testing
          return {} as RPCStream<Uint8Array, Uint8Array>;
        },
        logger,
        idGen,
      });
      // Timing out on stream creation
      const callerInterfaceProm = rpcClient.rawStreamCaller(
        'testMethod',
        {},
        { timer: 100 },
      );
      await expect(callerInterfaceProm).toReject();
      await expect(callerInterfaceProm).rejects.toThrow(
        rpcErrors.ErrorRPCTimedOut,
      );
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    });
    test('raw caller handles abort when creating stream', async () => {
      const holdProm = promise();
      const ctxProm = promise<ContextTimed>();
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctxProm.resolveP(ctx_);
          await holdProm.p;
          // Should never reach this when testing
          return {} as RPCStream<Uint8Array, Uint8Array>;
        },
        logger,
        idGen,
      });
      const abortController = new AbortController();
      const rejectReason = Symbol('rejectReason');

      // Timing out on stream creation
      const callerInterfaceProm = rpcClient.rawStreamCaller(
        'testMethod',
        {},
        { signal: abortController.signal },
      );
      abortController.abort(rejectReason);
      const ctx = await ctxProm.p;
      await expect(callerInterfaceProm).toReject();
      await expect(callerInterfaceProm).rejects.toBe(rejectReason);
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBe(rejectReason);
    });
    test('raw caller times out awaiting stream', async () => {
      const forwardPassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const reversePassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        writable: forwardPassThroughStream.writable,
        readable: reversePassThroughStream.readable,
      };
      const ctxProm = promise<ContextTimed>();
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctxProm.resolveP(ctx_);
          return streamPair;
        },
        logger,
        idGen,
      });
      // Timing out on stream
      await expect(
        Promise.all([
          rpcClient.rawStreamCaller('testMethod', {}, { timer: 100 }),
          forwardPassThroughStream.readable.getReader().read(),
        ]),
      ).rejects.toThrow(rpcErrors.ErrorRPCTimedOut);
      const ctx = await ctxProm.p;
      await ctx?.timer;
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    });
    test('raw caller handles abort awaiting stream', async () => {
      const forwardPassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const reversePassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        writable: forwardPassThroughStream.writable,
        readable: reversePassThroughStream.readable,
      };
      const ctxProm = promise<ContextTimed>();
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx) => {
          ctxProm.resolveP(ctx);
          return streamPair;
        },
        logger,
        idGen,
      });
      const abortController = new AbortController();
      const rejectReason = Symbol('rejectReason');
      // Timing out on stream
      const reader = forwardPassThroughStream.readable.getReader();
      const abortProm = promise<void>();
      const ctxWaitProm = ctxProm.p.then((ctx) => {
        if (ctx.signal.aborted) abortProm.resolveP();
        ctx.signal.addEventListener('abort', () => {
          abortProm.resolveP();
        });
        abortController.abort(rejectReason);
      });
      const rawStreamProm = rpcClient.rawStreamCaller(
        'testMethod',
        {},
        { signal: abortController.signal },
      );
      await Promise.allSettled([rawStreamProm, reader.read(), ctxWaitProm]);
      await expect(rawStreamProm).rejects.toBe(rejectReason);
      const ctx = await ctxProm.p;
      await abortProm.p;
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBe(rejectReason);
    });
  });
  describe('duplex caller', () => {
    test('duplex caller uses default timeout when creating stream', async () => {
      const holdProm = promise();
      let ctx: ContextTimed | undefined;
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctx = ctx_;
          await holdProm.p;
          // Should never reach this when testing
          return {} as RPCStream<Uint8Array, Uint8Array>;
        },
        timeoutTime: 100,
        logger,
        idGen,
      });
      // Timing out on stream creation
      const callerInterfaceProm = rpcClient.duplexStreamCaller('testMethod');
      await expect(callerInterfaceProm).toReject();
      await expect(callerInterfaceProm).rejects.toThrow(
        rpcErrors.ErrorRPCTimedOut,
      );
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    });
    test('duplex caller times out when creating stream', async () => {
      const holdProm = promise();
      let ctx: ContextTimed | undefined;
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctx = ctx_;
          await holdProm.p;
          // Should never reach this when testing
          return {} as RPCStream<Uint8Array, Uint8Array>;
        },
        logger,
        idGen,
      });
      // Timing out on stream creation
      const callerInterfaceProm = rpcClient.duplexStreamCaller('testMethod', {
        timer: 100,
      });
      await expect(callerInterfaceProm).toReject();
      await expect(callerInterfaceProm).rejects.toThrow(
        rpcErrors.ErrorRPCTimedOut,
      );
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    });
    test('duplex caller handles abort when creating stream', async () => {
      const holdProm = promise();
      let ctx: ContextTimed | undefined;
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctx = ctx_;
          await holdProm.p;
          // Should never reach this when testing
          return {} as RPCStream<Uint8Array, Uint8Array>;
        },
        logger,
        idGen,
      });
      const abortController = new AbortController();
      const rejectReason = Symbol('rejectReason');
      abortController.abort(rejectReason);

      // Timing out on stream creation
      const callerInterfaceProm = rpcClient.duplexStreamCaller('testMethod', {
        signal: abortController.signal,
      });
      await expect(callerInterfaceProm).toReject();
      await expect(callerInterfaceProm).rejects.toBe(rejectReason);
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBe(rejectReason);
    });
    test('duplex caller uses default timeout awaiting stream', async () => {
      const forwardPassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const reversePassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        writable: forwardPassThroughStream.writable,
        readable: reversePassThroughStream.readable,
      };
      let ctx: ContextTimed | undefined;
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctx = ctx_;
          return streamPair;
        },
        timeoutTime: 100,
        logger,
        idGen,
      });

      // Timing out on stream
      await rpcClient.duplexStreamCaller('testMethod');
      await ctx?.timer;
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    });
    test('duplex caller times out awaiting stream', async () => {
      const forwardPassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const reversePassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        writable: forwardPassThroughStream.writable,
        readable: reversePassThroughStream.readable,
      };
      let ctx: ContextTimed | undefined;
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx_) => {
          ctx = ctx_;
          return streamPair;
        },
        logger,
        idGen,
      });

      // Timing out on stream
      await rpcClient.duplexStreamCaller('testMethod', {
        timer: 100,
      });
      await ctx?.timer;
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    });
    test('duplex caller handles abort awaiting stream', async () => {
      const forwardPassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const reversePassThroughStream = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: async (reason) => {
          await forwardPassThroughStream.readable.cancel(reason);
          await reversePassThroughStream.writable.abort(reason);
        },
        meta: undefined,
        writable: forwardPassThroughStream.writable,
        readable: reversePassThroughStream.readable,
      };
      const ctxProm = promise<ContextTimed>();
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx) => {
          ctxProm.resolveP(ctx);
          return streamPair;
        },
        logger,
        idGen,
      });
      const abortController = new AbortController();
      const rejectReason = Symbol('rejectReason');
      abortController.abort(rejectReason);
      // Timing out on stream
      const stream = await rpcClient.duplexStreamCaller('testMethod', {
        signal: abortController.signal,
      });
      const ctx = await ctxProm.p;
      const abortProm = promise<void>();
      if (ctx.signal.aborted) abortProm.resolveP();
      ctx.signal.addEventListener('abort', () => {
        abortProm.resolveP();
      });
      expect(ctx?.signal.aborted).toBeTrue();
      expect(ctx?.signal.reason).toBe(rejectReason);
      stream.cancel(Error('asd'));
    });
    testProp(
      'duplex caller timeout is cancelled when receiving message',
      [specificMessageArb],
      async (messages) => {
        const inputStream = rpcTestUtils.messagesToReadableStream(messages);
        const streamPair: RPCStream<Uint8Array, Uint8Array> = {
          cancel: () => {},
          meta: undefined,
          readable: inputStream,
          writable: new WritableStream(),
        };
        const ctxProm = promise<ContextTimed>();
        const rpcClient = new RPCClient({
          manifest: {},
          streamFactory: async (ctx) => {
            ctxProm.resolveP(ctx);
            return streamPair;
          },
          logger,
          idGen,
        });
        const callerInterface = await rpcClient.duplexStreamCaller<
          JSONRPCParams,
          JSONRPCResult
        >(methodName, { timer: 200 });

        const ctx = await ctxProm.p;
        const reader = callerInterface.readable.getReader();
        reader.releaseLock();
        for await (const _ of callerInterface.readable) {
          // Do nothing
        }
        await expect(ctx.timer).rejects.toBe(timeoutCancelledReason);
      },
      { numRuns: 5 },
    );
  });
  testProp(
    'duplex caller timeout is not cancelled when receiving message with provided ctx',
    [specificMessageArb],
    async (messages) => {
      const inputStream = rpcTestUtils.messagesToReadableStream(messages);
      const streamPair: RPCStream<Uint8Array, Uint8Array> = {
        cancel: () => {},
        meta: undefined,
        readable: inputStream,
        writable: new WritableStream(),
      };
      const ctxProm = promise<ContextTimed>();
      const rpcClient = new RPCClient({
        manifest: {},
        streamFactory: async (ctx) => {
          ctxProm.resolveP(ctx);
          return streamPair;
        },
        logger,
        idGen,
      });
      const callerInterface = await rpcClient.duplexStreamCaller<
        JSONRPCParams,
        JSONRPCResult
      >(methodName, { timer: new Timer(undefined, 200) });

      const ctx = await ctxProm.p;
      const reader = callerInterface.readable.getReader();
      reader.releaseLock();
      for await (const _ of callerInterface.readable) {
        // Do nothing
      }
      await ctx.timer;
      expect(ctx.signal.reason).toBeInstanceOf(rpcErrors.ErrorRPCTimedOut);
    },
    { numRuns: 5 },
  );
  describe('timeout priority', () => {
    testProp(
      'check that call with ctx can override higher timeout of RPCClient',
      [rpcTestUtils.timeoutsArb],
      async ([lowerTimeoutTime, higherTimeoutTime]) => {
        const streamPair: RPCStream<Uint8Array, Uint8Array> = {
          cancel: () => {},
          meta: undefined,
          readable: new ReadableStream(),
          writable: new WritableStream(),
        };
        const { p: ctxP, resolveP: resolveCtxP } = promise<ContextTimed>();
        const rpcClient = new RPCClient({
          manifest: {},
          streamFactory: async (ctx) => {
            resolveCtxP(ctx);
            return streamPair;
          },
          logger,
          idGen,
          timeoutTime: higherTimeoutTime,
        });

        await rpcClient.duplexStreamCaller<JSONRPCParams, JSONRPCResult>(
          methodName,
          {
            timer: lowerTimeoutTime,
          },
        );

        const ctx = await ctxP;
        expect(ctx.timer.delay).toBe(lowerTimeoutTime);
        ctx.timer.cancel();
        await ctx.timer.catch(() => {});
      },
    );
    testProp(
      'check that call with ctx can override lower timeout of RPCClient',
      [rpcTestUtils.timeoutsArb],
      async ([lowerTimeoutTime, higherTimeoutTime]) => {
        const streamPair: RPCStream<Uint8Array, Uint8Array> = {
          cancel: () => {},
          meta: undefined,
          readable: new ReadableStream(),
          writable: new WritableStream(),
        };
        const { p: ctxP, resolveP: resolveCtxP } = promise<ContextTimed>();
        const rpcClient = new RPCClient({
          manifest: {},
          streamFactory: async (ctx) => {
            resolveCtxP(ctx);
            return streamPair;
          },
          logger,
          idGen,
          timeoutTime: lowerTimeoutTime,
        });

        await rpcClient.duplexStreamCaller<JSONRPCParams, JSONRPCResult>(
          methodName,
          {
            timer: higherTimeoutTime,
          },
        );

        const ctx = await ctxP;
        expect(ctx.timer.delay).toBe(higherTimeoutTime);
        ctx.timer.cancel();
        await ctx.timer.catch(() => {});
      },
    );
    testProp(
      'check that call with ctx can override lower timeout of RPCClient with Infinity',
      [fc.integer({ min: 0 })],
      async (timeoutTime) => {
        const streamPair: RPCStream<Uint8Array, Uint8Array> = {
          cancel: () => {},
          meta: undefined,
          readable: new ReadableStream(),
          writable: new WritableStream(),
        };
        const { p: ctxP, resolveP: resolveCtxP } = promise<ContextTimed>();
        const rpcClient = new RPCClient({
          manifest: {},
          streamFactory: async (ctx) => {
            resolveCtxP(ctx);
            return streamPair;
          },
          logger,
          idGen,
          timeoutTime,
        });

        await rpcClient.duplexStreamCaller<JSONRPCParams, JSONRPCResult>(
          methodName,
          {
            timer: Infinity,
          },
        );

        const ctx = await ctxP;
        expect(ctx.timer.delay).toBe(Infinity);
        ctx.timer.cancel();
        await ctx.timer.catch(() => {});
      },
    );
    testProp(
      'Check that ctx is provided to the middleware and that the middleware can reset the timer',
      [specificMessageArb],
      async (messages) => {
        const inputStream = rpcTestUtils.messagesToReadableStream(messages);
        const [outputResult, outputStream] =
          rpcTestUtils.streamToArray<Uint8Array>();
        const streamPair: RPCStream<Uint8Array, Uint8Array> = {
          cancel: () => {},
          meta: undefined,
          readable: inputStream,
          writable: outputStream,
        };
        const ctxProm = promise<ContextTimed>();
        const rpcClient = new RPCClient({
          manifest: {},
          streamFactory: async (ctx) => {
            ctxProm.resolveP(ctx);
            return streamPair;
          },
          middlewareFactory: rpcUtilsMiddleware.defaultClientMiddlewareWrapper(
            (ctx) => {
              ctx.timer.reset(123);
              return {
                forward: new TransformStream(),
                reverse: new TransformStream(),
              };
            },
          ),
          logger,
          idGen,
        });
        const callerInterface = await rpcClient.duplexStreamCaller<
          JSONRPCParams,
          JSONRPCResult
        >(methodName);

        const ctx = await ctxProm.p;
        // Writing should refresh timer engage the middleware
        const writer = callerInterface.writable.getWriter();
        await writer.write({});
        expect(ctx.timer.delay).toBe(123);
        await writer.close();

        await outputResult;
      },
      { numRuns: 1 },
    );
  });
});
