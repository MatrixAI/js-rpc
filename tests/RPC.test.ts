import type { ContainerType, JSONRPCRequest } from '@/types';
import type { ReadableStream } from 'stream/web';
import type { JSONValue, IdGen } from '@/types';
import type { ContextTimed } from '@matrixai/contexts';
import { TransformStream } from 'stream/web';
import { fc, testProp } from '@fast-check/jest';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import RawCaller from '@/callers/RawCaller';
import DuplexCaller from '@/callers/DuplexCaller';
import ServerCaller from '@/callers/ServerCaller';
import ClientCaller from '@/callers/ClientCaller';
import UnaryCaller from '@/callers/UnaryCaller';
import * as rpcUtilsMiddleware from '@/utils/middleware';
import {
  ErrorRPC,
  ErrorRPCHandlerFailed,
  ErrorRPCParse,
  ErrorRPCRemote,
  ErrorRPCTimedOut,
  JSONRPCErrorCode,
} from '@/errors';
import * as rpcErrors from '@/errors';
import RPCClient from '@/RPCClient';
import RPCServer from '@/RPCServer';
import * as utils from '@/utils';
import DuplexHandler from '@/handlers/DuplexHandler';
import RawHandler from '@/handlers/RawHandler';
import ServerHandler from '@/handlers/ServerHandler';
import UnaryHandler from '@/handlers/UnaryHandler';
import ClientHandler from '@/handlers/ClientHandler';
import { RPCStream } from '@/types';
import { fromError, promise, replacer, toError } from '@/utils';
import * as rpcTestUtils from './utils';

describe('RPC', () => {
  const logger = new Logger(`RPC Test`, LogLevel.WARN, [new StreamHandler()]);
  const idGen: IdGen = () => Promise.resolve(null);
  testProp(
    'RPC communication with raw stream',
    [rpcTestUtils.rawDataArb],
    async (inputData) => {
      const [outputResult, outputWriterStream] =
        rpcTestUtils.streamToArray<Uint8Array>();
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      let header: JSONRPCRequest | undefined;

      class TestMethod extends RawHandler<ContainerType> {
        public handle = async (
          input: [JSONRPCRequest<JSONValue>, ReadableStream<Uint8Array>],
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
        ): Promise<[JSONValue, ReadableStream<Uint8Array>]> => {
          return new Promise((resolve) => {
            const [header_, stream] = input;
            header = header_;
            resolve(['some leading data', stream]);
          });
        };
      }
      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      rpcServer.handleStream({
        ...serverPair,
        cancel: () => {},
      });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new RawCaller(),
        },
        streamFactory: async () => {
          return {
            ...clientPair,
            cancel: () => {},
          };
        },
        logger,
        idGen,
      });

      const callerInterface = await rpcClient.methods.testMethod({
        hello: 'world',
      });
      const writer = callerInterface.writable.getWriter();
      const pipeProm = callerInterface.readable.pipeTo(outputWriterStream);
      for (const value of inputData) {
        await writer.write(value);
      }
      await writer.close();
      const expectedHeader: JSONRPCRequest = {
        jsonrpc: '2.0',
        method: 'testMethod',
        params: { hello: 'world' },
        id: null,
      };
      expect(header).toStrictEqual(expectedHeader);
      expect(callerInterface.meta?.result).toBe('some leading data');
      expect(await outputResult).toStrictEqual(inputData);
      await pipeProm;
      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );
  test('RPC communication with raw stream times out waiting for leading message', async () => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();
    void (async () => {
      for await (const _ of serverPair.readable) {
        // Just consume
      }
    })();

    const rpcClient = await RPCClient.createRPCClient({
      manifest: {
        testMethod: new RawCaller(),
      },
      streamFactory: async () => {
        return {
          ...clientPair,
          cancel: () => {},
        };
      },
      logger,
      idGen,
    });

    await expect(
      rpcClient.methods.testMethod(
        {
          hello: 'world',
        },
        { timer: 100 },
      ),
    ).rejects.toThrow(rpcErrors.ErrorRPCTimedOut);
    await rpcClient.destroy();
  });
  test('RPC communication with raw stream, raw handler throws', async () => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    class TestMethod extends RawHandler<ContainerType> {
      public handle = async (
        input: [JSONRPCRequest<JSONValue>, ReadableStream<Uint8Array>],
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): Promise<[JSONValue, ReadableStream<Uint8Array>]> => {
        throw new Error('some error');
      };
    }

    const rpcServer = await RPCServer.createRPCServer({
      manifest: {
        testMethod: new TestMethod({}),
      },
      logger,
      idGen,
    });
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = await RPCClient.createRPCClient({
      manifest: {
        testMethod: new RawCaller(),
      },
      streamFactory: async () => {
        return {
          ...clientPair,
          cancel: () => {},
        };
      },
      logger,
      idGen,
    });

    await expect(
      rpcClient.methods.testMethod({
        hello: 'world',
      }),
    ).rejects.toThrow(rpcErrors.ErrorRPCRemote);

    await rpcServer.destroy();
    await rpcClient.destroy();
  });
  testProp(
    'RPC communication with duplex stream',
    [fc.array(rpcTestUtils.safeJsonValueArb, { minLength: 1 })],
    async (values) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();
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
      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      rpcServer.handleStream({
        ...serverPair,
        cancel: () => {},
      });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new DuplexCaller(),
        },
        streamFactory: async () => {
          return {
            ...clientPair,
            cancel: () => {},
          };
        },
        logger,
        idGen,
      });

      const callerInterface = await rpcClient.methods.testMethod();
      const writer = callerInterface.writable.getWriter();
      const reader = callerInterface.readable.getReader();
      for (const value of values) {
        await writer.write(value);
        expect((await reader.read()).value).toStrictEqual(value);
      }
      await writer.close();
      const result = await reader.read();
      expect(result.value).toBeUndefined();
      expect(result.done).toBeTrue();
      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );
  testProp(
    'RPC communication with server stream',
    [fc.integer({ min: 1, max: 100 })],
    async (value) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends ServerHandler<ContainerType, number, number> {
        public handle = async function* (
          input: number,
        ): AsyncGenerator<number> {
          for (let i = 0; i < input; i++) {
            yield i;
          }
        };
      }

      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      rpcServer.handleStream({
        ...serverPair,
        cancel: () => {},
      });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new ServerCaller<number, number>(),
        },
        streamFactory: async () => {
          return {
            ...clientPair,
            cancel: () => {},
          };
        },
        logger,
        idGen,
      });

      const callerInterface = await rpcClient.methods.testMethod(value);

      const outputs: Array<number> = [];
      for await (const num of callerInterface) {
        outputs.push(num);
      }
      expect(outputs.length).toEqual(value);
      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );
  testProp(
    'RPC communication with client stream',
    [fc.array(fc.integer(), { minLength: 1 }).noShrink()],
    async (values) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends ClientHandler<ContainerType, number, number> {
        public handle = async (
          input: AsyncIterable<number>,
        ): Promise<number> => {
          let acc = 0;
          for await (const number of input) {
            acc += number;
          }
          return acc;
        };
      }

      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      rpcServer.handleStream({
        ...serverPair,
        cancel: () => {},
      });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new ClientCaller<number, number>(),
        },
        streamFactory: async () => {
          return {
            ...clientPair,
            cancel: () => {},
          };
        },
        logger,
        idGen,
      });

      const { output, writable } = await rpcClient.methods.testMethod();
      const writer = writable.getWriter();
      for (const value of values) {
        await writer.write(value);
      }
      await writer.close();
      const expectedResult = values.reduce((p, c) => p + c);
      await expect(output).resolves.toEqual(expectedResult);
      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );
  testProp(
    'RPC communication with unary call',
    [rpcTestUtils.safeJsonValueArb],
    async (value) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends UnaryHandler {
        public handle = async (input: JSONValue): Promise<JSONValue> => {
          return input;
        };
      }
      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      rpcServer.handleStream({
        ...serverPair,
        cancel: () => {},
      });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new UnaryCaller(),
        },
        streamFactory: async () => {
          return {
            ...clientPair,
            cancel: () => {},
          };
        },
        logger,
        idGen,
      });

      const result = await rpcClient.methods.testMethod(value);
      expect(result).toStrictEqual(value);
      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );
  testProp(
    'RPC handles and sends errors',
    [
      rpcTestUtils.safeJsonValueArb,
      rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
    ],
    async (value, error) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends UnaryHandler {
        public handle = async (
          _input: JSONValue,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          _ctx: ContextTimed,
        ): Promise<JSONValue> => {
          throw error;
        };
      }

      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        logger,
        idGen,
      });
      rpcServer.handleStream({ ...serverPair, cancel: () => {} });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new UnaryCaller(),
        },
        streamFactory: async () => {
          return { ...clientPair, cancel: () => {} };
        },
        logger,
        idGen,
      });

      // Create a new promise so we can await it multiple times for assertions
      const callProm = rpcClient.methods.testMethod(value).catch((e) => e);

      // The promise should be rejected
      const rejection = await callProm;

      // The error should have specific properties
      expect(rejection).toBeInstanceOf(rpcErrors.ErrorRPCRemote);
      expect(rejection).toMatchObject({ code: -32006 });

      // Cleanup
      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );

  testProp(
    'RPC handles and sends sensitive errors',
    [
      rpcTestUtils.safeJsonValueArb,
      rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
    ],
    async (value, error) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends UnaryHandler {
        public handle = async (
          _input: JSONValue,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          _ctx: ContextTimed,
        ): Promise<JSONValue> => {
          throw error;
        };
      }

      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        sensitive: true,
        logger,
        idGen,
      });
      rpcServer.handleStream({ ...serverPair, cancel: () => {} });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new UnaryCaller(),
        },
        streamFactory: async () => {
          return { ...clientPair, cancel: () => {} };
        },
        logger,
        idGen,
      });

      const callProm = rpcClient.methods.testMethod(ErrorRPCRemote.description);

      // Use Jest's `.rejects` to handle the promise rejection
      await expect(callProm).rejects.toBeInstanceOf(rpcErrors.ErrorRPCRemote);
      await expect(callProm).rejects.not.toHaveProperty('cause.stack');

      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );

  test('middleware can end stream early', async () => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncIterableIterator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncIterableIterator<JSONValue> {
        yield* input;
      };
    }

    const middleware = rpcUtilsMiddleware.defaultServerMiddlewareWrapper(() => {
      return {
        forward: new TransformStream({
          start: (controller) => {
            // Controller.terminate();
            controller.error(Error('SOME ERROR'));
          },
        }),
        reverse: new TransformStream({
          start: (controller) => {
            controller.error(Error('SOME ERROR'));
          },
        }),
      };
    });
    const rpcServer = await RPCServer.createRPCServer({
      manifest: {
        testMethod: new TestMethod({}),
      },
      middlewareFactory: middleware,
      logger,
      idGen,
    });
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = await RPCClient.createRPCClient({
      manifest: {
        testMethod: new DuplexCaller(),
      },
      streamFactory: async () => {
        return {
          ...clientPair,
          cancel: () => {},
        };
      },
      logger,
      idGen,
    });

    const callerInterface = await rpcClient.methods.testMethod();
    const writer = callerInterface.writable.getWriter();
    await writer.write({});
    // Allow time to process buffer
    await utils.sleep(0);
    await expect(writer.write({})).toReject();
    const reader = callerInterface.readable.getReader();
    await expect(reader.read()).toReject();
    await expect(writer.closed).toReject();
    await expect(reader.closed).toReject();
    await expect(rpcServer.destroy(false)).toResolve();
    await rpcClient.destroy();
  });
  test('RPC client and server timeout concurrently', async () => {
    let serverTimedOut = false;
    let clientTimedOut = false;
    // Generate test data (assuming fc.array generates some mock array)
    const values = fc.array(rpcTestUtils.safeJsonValueArb, { minLength: 1 });

    // Setup server and client communication pairs
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    const timeout = 1;
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncIterableIterator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncIterableIterator<JSONValue> {
        // Check for abort event
        ctx.signal.throwIfAborted();
        const abortProm = utils.promise<never>();
        ctx.signal.addEventListener('abort', () => {
          abortProm.rejectP(ctx.signal.reason);
        });
        await abortProm.p;
      };
    }
    const testMethodInstance = new TestMethod({});
    // Set up a client and server with matching timeout settings
    const rpcServer = await RPCServer.createRPCServer({
      manifest: {
        testMethod: testMethodInstance,
      },
      logger,
      idGen,
      handlerTimeoutTime: timeout,
    });
    // Register callback
    rpcServer.registerOnTimeoutCallback(() => {
      serverTimedOut = true;
    });
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = await RPCClient.createRPCClient({
      manifest: {
        testMethod: new DuplexCaller(),
      },
      streamFactory: async () => {
        return {
          ...clientPair,
          cancel: () => {},
        };
      },
      logger,
      idGen,
    });
    const callerInterface = await rpcClient.methods.testMethod({
      timer: timeout,
    });
    // Register callback
    rpcClient.registerOnTimeoutCallback(() => {
      clientTimedOut = true;
    });
    const writer = callerInterface.writable.getWriter();
    const reader = callerInterface.readable.getReader();
    // Wait for server and client to timeout by checking the flag
    await new Promise<void>((resolve) => {
      const checkFlag = () => {
        if (serverTimedOut && clientTimedOut) resolve();
        else setTimeout(() => checkFlag(), 10);
      };
      checkFlag();
    });
    // Expect both the client and the server to time out
    await expect(writer.write(values[0])).rejects.toThrow(
      'Timed out waiting for header',
    );

    await expect(reader.read()).rejects.toThrow('Timed out waiting for header');

    await rpcServer.destroy();
    await rpcClient.destroy();
  });
  // Test description
  test('RPC server times out before client', async () => {
    let serverTimedOut = false;

    // Generate test data (assuming fc.array generates some mock array)
    const values = fc.array(rpcTestUtils.safeJsonValueArb, { minLength: 1 });

    // Setup server and client communication pairs
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    // Define the server's method behavior
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncIterableIterator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ) {
        ctx.signal.throwIfAborted();
        const abortProm = utils.promise<never>();
        ctx.signal.addEventListener('abort', () => {
          abortProm.rejectP(ctx.signal.reason);
        });
        await abortProm.p;
      };
    }

    // Create an instance of the RPC server with a shorter timeout
    const rpcServer = await RPCServer.createRPCServer({
      manifest: { testMethod: new TestMethod({}) },
      logger,
      idGen,
      handlerTimeoutTime: 1,
    });
    // Register callback
    rpcServer.registerOnTimeoutCallback(() => {
      serverTimedOut = true;
    });
    rpcServer.handleStream({ ...serverPair, cancel: () => {} });

    // Create an instance of the RPC client with a longer timeout
    const rpcClient = await RPCClient.createRPCClient({
      manifest: { testMethod: new DuplexCaller() },
      streamFactory: async () => ({ ...clientPair, cancel: () => {} }),
      logger,
      idGen,
    });

    // Get server and client interfaces
    const callerInterface = await rpcClient.methods.testMethod({
      timer: 10,
    });
    const writer = callerInterface.writable.getWriter();
    const reader = callerInterface.readable.getReader();
    // Wait for server to timeout by checking the flag
    await new Promise<void>((resolve) => {
      const checkFlag = () => {
        if (serverTimedOut) resolve();
        else setTimeout(() => checkFlag(), 10);
      };
      checkFlag();
    });

    // We expect server to timeout before the client
    await expect(writer.write(values[0])).rejects.toThrow(
      'Timed out waiting for header',
    );
    await expect(reader.read()).rejects.toThrow('Timed out waiting for header');

    // Cleanup
    await rpcServer.destroy();
    await rpcClient.destroy();
  });
  test('RPC client times out before server', async () => {
    // Generate test data (assuming fc.array generates some mock array)
    const values = fc.array(rpcTestUtils.safeJsonValueArb, { minLength: 1 });

    // Setup server and client communication pairs
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncIterableIterator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncIterableIterator<JSONValue> {
        ctx.signal.throwIfAborted();
        const abortProm = utils.promise<never>();
        ctx.signal.addEventListener('abort', () => {
          abortProm.rejectP(ctx.signal.reason);
        });
        await abortProm.p;
      };
    }
    // Set up a client and server with matching timeout settings
    const rpcServer = await RPCServer.createRPCServer({
      manifest: {
        testMethod: new TestMethod({}),
      },
      logger,
      idGen,

      handlerTimeoutTime: 400,
    });
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = await RPCClient.createRPCClient({
      manifest: {
        testMethod: new DuplexCaller(),
      },
      streamFactory: async () => {
        return {
          ...clientPair,
          cancel: () => {},
        };
      },
      logger,
      idGen,
    });
    const callerInterface = await rpcClient.methods.testMethod({ timer: 300 });
    const writer = callerInterface.writable.getWriter();
    const reader = callerInterface.readable.getReader();
    // Expect the client to time out first
    await expect(writer.write(values[0])).toResolve();
    await expect(reader.read()).toReject();

    await rpcServer.destroy();
    await rpcClient.destroy();
  });
  test('RPC client and server with infinite timeout', async () => {
    // Set up a client and server with infinite timeout settings
    const values = fc.array(rpcTestUtils.safeJsonValueArb, { minLength: 3 });

    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncIterableIterator<JSONValue>,
        cancel: (reason?: any) => void,
        meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ) {
        ctx.signal.throwIfAborted();
        const abortProm = utils.promise<never>();
        ctx.signal.addEventListener('abort', () => {
          abortProm.rejectP(ctx.signal.reason);
        });
        await abortProm.p;
      };
    }

    const rpcServer = await RPCServer.createRPCServer({
      manifest: { testMethod: new TestMethod({}) },
      logger,
      idGen,
      handlerTimeoutTime: Infinity,
    });
    rpcServer.handleStream({ ...serverPair, cancel: () => {} });

    const rpcClient = await RPCClient.createRPCClient({
      manifest: { testMethod: new DuplexCaller() },
      streamFactory: async () => ({ ...clientPair, cancel: () => {} }),
      logger,
      idGen,
    });

    const callerInterface = await rpcClient.methods.testMethod({
      timer: Infinity,
    });

    const writer = callerInterface.writable.getWriter();
    const reader = callerInterface.readable.getReader();

    // Trigger a call that will hang indefinitely or for a long time #TODO

    // Write a value to the stream
    const writePromise = writer.write(values[0]);

    // Trigger a read that will hang indefinitely

    const readPromise = reader.read();
    // Adding a randomized sleep here to check that neither timeout
    const randomSleepTime = Math.floor(Math.random() * 1000) + 1;
    // Random time between 1 and 1,000 ms
    await utils.sleep(randomSleepTime);
    // At this point, writePromise and readPromise should neither be resolved nor rejected
    // because the server method is hanging.

    // Check if the promises are neither resolved nor rejected
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve('timeout'), 1000),
    );

    const readStatus = await Promise.race([readPromise, timeoutPromise]);
    // Check if read status is still pending;

    expect(readStatus).toBe('timeout');

    // Expect neither to time out and verify that they can still handle other operations #TODO
    await rpcServer.destroy();
    await rpcClient.destroy();
  });

  testProp(
    'RPC Serializes and Deserializes ErrorRPCRemote',
    [
      rpcTestUtils.safeJsonValueArb,
      rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
    ],
    async (value, error) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends UnaryHandler {
        public handle = async (
          _input: JSONValue,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          _ctx: ContextTimed,
        ): Promise<JSONValue> => {
          throw error;
        };
      }
      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        sensitive: true,
        logger,
        idGen,
        fromError: utils.fromError,
        replacer: utils.replacer,
      });
      rpcServer.handleStream({ ...serverPair, cancel: () => {} });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new UnaryCaller(),
        },
        streamFactory: async () => {
          return { ...clientPair, cancel: () => {} };
        },
        logger,
        idGen,
      });

      const errorInstance = new ErrorRPCRemote(
        { code: -32006 },
        'Parse error',
        { cause: error, data: 'The server responded with an error' },
      );

      const serializedError = fromError(errorInstance);
      const deserializedError = rpcClient.toError(serializedError);

      expect(deserializedError).toBeInstanceOf(ErrorRPCRemote);

      // Check properties explicitly
      const { code, message, data } = deserializedError as ErrorRPCRemote<any>;
      expect(code).toBe(-32006);
      expect(message).toBe('Parse error');
      expect(data).toBe('The server responded with an error');

      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );
  testProp(
    'RPC Serializes and Deserializes ErrorRPCRemote with Custom Replacer Function',
    [
      rpcTestUtils.safeJsonValueArb,
      rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
    ],
    async (value, error) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends UnaryHandler {
        public handle = async (
          _input: JSONValue,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          _ctx: ContextTimed,
        ): Promise<JSONValue> => {
          throw error;
        };
      }
      const rpcServer = await RPCServer.createRPCServer({
        manifest: {
          testMethod: new TestMethod({}),
        },
        sensitive: true,
        logger,
        idGen,
        fromError: utils.fromError,
        replacer: utils.replacer,
      });
      rpcServer.handleStream({ ...serverPair, cancel: () => {} });

      const rpcClient = await RPCClient.createRPCClient({
        manifest: {
          testMethod: new UnaryCaller(),
        },
        streamFactory: async () => {
          return { ...clientPair, cancel: () => {} };
        },
        logger,
        idGen,
      });

      const errorInstance = new ErrorRPCRemote(
        { code: -32006 },
        'Parse error',
        { cause: error, data: 'asda' },
      );

      const serializedError = JSON.parse(
        JSON.stringify(fromError(errorInstance), replacer('data')),
      );

      const callProm = rpcClient.methods.testMethod(serializedError);
      const catchError = await callProm.catch((e) => e);

      const deserializedError = toError(serializedError);

      expect(deserializedError).toBeInstanceOf(ErrorRPCRemote);

      // Check properties explicitly
      const { code, message, data } = deserializedError as ErrorRPCRemote<any>;
      expect(code).toBe(-32006);
      expect(message).toBe('Parse error');
      expect(data).toBe(undefined);

      await rpcServer.destroy();
      await rpcClient.destroy();
    },
  );
});
