import type {
  ContainerType,
  JSONObject,
  JSONRPCRequestParams,
  JSONRPCRequest,
  JSONRPCResponseResult,
} from '@/types';
import type { ReadableStream } from 'stream/web';
import type { JSONValue, IdGen } from '@/types';
import type { ContextTimed } from '@matrixai/contexts';
import { TransformStream } from 'stream/web';
import { fc, test } from '@fast-check/jest';
import Logger, { LogLevel, StreamHandler } from '@matrixai/logger';
import { Timer } from '@matrixai/timer';
import RawCaller from '@/callers/RawCaller';
import DuplexCaller from '@/callers/DuplexCaller';
import ServerCaller from '@/callers/ServerCaller';
import ClientCaller from '@/callers/ClientCaller';
import UnaryCaller from '@/callers/UnaryCaller';
import * as rpcUtilsMiddleware from '@/middleware';
import { ErrorRPCRemote } from '@/errors';
import * as rpcErrors from '@/errors';
import RPCClient from '@/RPCClient';
import RPCServer from '@/RPCServer';
import * as utils from '@/utils';
import DuplexHandler from '@/handlers/DuplexHandler';
import RawHandler from '@/handlers/RawHandler';
import ServerHandler from '@/handlers/ServerHandler';
import UnaryHandler from '@/handlers/UnaryHandler';
import ClientHandler from '@/handlers/ClientHandler';
import { filterSensitive } from '@/utils';
import * as rpcTestUtils from './utils';

describe('RPC', () => {
  const logger = new Logger(`RPC Test`, LogLevel.WARN, [new StreamHandler()]);
  const idGen: IdGen = () => Promise.resolve(null);

  test.prop(
    {
      values: rpcTestUtils.rawDataArb,
    },
    {},
  )('RPC communication with raw stream', async ({ values }) => {
    const [outputResult, outputWriterStream] =
      rpcTestUtils.streamToArray<Uint8Array>();
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    let header: JSONRPCRequest | undefined = undefined;

    class TestMethod extends RawHandler<ContainerType> {
      public handle = async (
        input: [JSONRPCRequest<JSONObject>, ReadableStream<Uint8Array>],
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
      ): Promise<[JSONObject, ReadableStream<Uint8Array>]> => {
        return new Promise((resolve) => {
          const [header_, stream] = input;
          header = header_;
          resolve([{ value: 'some leading data' }, stream]);
        });
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
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
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
    for (const value of values) {
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
    expect(callerInterface.meta?.result).toStrictEqual({
      value: 'some leading data',
    });
    expect(await outputResult).toStrictEqual(values);
    await pipeProm;
    await rpcServer.stop({ force: true });
  });
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

    const rpcClient = new RPCClient({
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
  });
  test('RPC communication with raw stream, raw handler throws', async () => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    class TestMethod extends RawHandler<ContainerType> {
      public handle = async (
        _input: [JSONRPCRequest, ReadableStream<Uint8Array>],
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): Promise<[JSONObject, ReadableStream<Uint8Array>]> => {
        throw new Error('some error');
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
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
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
    const callP = rpcClient.methods.testMethod({
      hello: 'world',
    });
    await expect(callP).rejects.toThrow(rpcErrors.ErrorRPCRemote);
    const result = await callP.catch((e) => e);
    expect(result.cause.message).toBe('some error');

    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      values: fc.array(rpcTestUtils.safeJsonObjectArb, { minLength: 1 }),
    },
    {},
  )('RPC communication with duplex stream', async ({ values }) => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncGenerator<JSONObject>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncGenerator<JSONObject> {
        yield* input;
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
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
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
      const receivedValue = (await reader.read()).value;
      if (
        receivedValue?.metadata != null &&
        receivedValue.metadata.timeout === null
      ) {
        receivedValue.metadata.timeout = Infinity;
      }
      expect(receivedValue).toStrictEqual(value);
    }
    await writer.close();
    const result = await reader.read();
    expect(result.value).toBeUndefined();
    expect(result.done).toBeTrue();
    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      values: fc
        .array(rpcTestUtils.safeJsonObjectArb, { minLength: 1 })
        .noShrink(),
    },
    { numRuns: 1 },
  )(
    'RPC communication with duplex stream responds after timeout',
    async ({ values }) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();
      class TestMethod extends DuplexHandler {
        public handle = async function* (
          input: AsyncGenerator<JSONObject>,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): AsyncGenerator<JSONObject> {
          const { p, resolveP } = utils.promise<void>();
          if (ctx.signal.aborted) resolveP();
          ctx.signal.addEventListener(
            'abort',
            () => {
              resolveP();
            },
            { once: true },
          );
          await p;
          yield* input;
        };
      }
      const rpcServer = new RPCServer({
        timeoutTime: 500,
        logger,
        idGen,
      });
      await rpcServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
      });
      rpcServer.handleStream({
        ...serverPair,
        cancel: () => {},
      });

      let aborted = false;
      const rpcClient = new RPCClient({
        manifest: {
          testMethod: new DuplexCaller(),
        },
        streamFactory: async () => {
          return {
            ...clientPair,
            cancel: () => {
              aborted = true;
            },
          };
        },
        timeoutTime: 500,
        graceTime: 1000,
        logger,
        idGen,
      });

      const callerInterface = await rpcClient.methods.testMethod();
      const writer = callerInterface.writable.getWriter();
      const reader = callerInterface.readable.getReader();
      for (const value of values) {
        await writer.write(value);
        const receivedValue = (await reader.read()).value;
        if (
          receivedValue?.metadata != null &&
          receivedValue.metadata.timeout === null
        ) {
          receivedValue.metadata.timeout = Infinity;
        }
        expect(receivedValue).toStrictEqual(value);
      }
      await writer.close();
      const result = await reader.read();
      expect(result.value).toBeUndefined();
      expect(result.done).toBeTrue();
      expect(aborted).toBeFalse();
      await rpcServer.stop({ force: true });
    },
  );
  test.prop({
    value: fc.integer({ min: 1, max: 100 }),
  })('RPC communication with server stream', async ({ value }) => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    class TestMethod extends ServerHandler<
      ContainerType,
      { value: number },
      { value: number }
    > {
      public handle = async function* (input: {
        value: number;
      }): AsyncGenerator<{ value: number }> {
        for (let i = 0; i < input.value; i++) {
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
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
      manifest: {
        testMethod: new ServerCaller<{ value: number }, { value: number }>(),
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

    const callerInterface = await rpcClient.methods.testMethod({ value });

    const outputs: Array<number> = [];
    for await (const num of callerInterface) {
      outputs.push(num.value);
    }
    expect(outputs.length).toEqual(value);
    await rpcServer.stop({ force: true });
  });
  test.prop({
    values: fc.array(fc.integer(), { minLength: 1 }).noShrink(),
  })('RPC communication with client stream', async ({ values }) => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    class TestMethod extends ClientHandler<
      ContainerType,
      { value: number },
      { value: number }
    > {
      public handle = async (
        input: AsyncIterable<{ value: number }>,
      ): Promise<{ value: number }> => {
        let acc = 0;
        for await (const number of input) {
          acc += number.value;
        }
        return { value: acc };
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
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
      manifest: {
        testMethod: new ClientCaller<{ value: number }, { value: number }>(),
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
      await writer.write({ value });
    }
    await writer.close();
    const expectedResult = values.reduce((p, c) => p + c);
    await expect(output).resolves.toHaveProperty('value', expectedResult);
    await rpcServer.stop({ force: true });
  });
  test.prop({
    value: rpcTestUtils.safeJsonObjectArb,
  })('RPC communication with unary call', async ({ value }) => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

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
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
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
    if (result.metadata != null && result.metadata.timeout === null) {
      result.metadata.timeout = Infinity;
    }
    expect(result).toEqual(value);
    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      value: rpcTestUtils.safeJsonObjectArb,
    },
    { numRuns: 1 },
  )(
    'RPC communication with unary call responds after timeout',
    async ({ value }) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends UnaryHandler {
        public handle = async (
          input: JSONRPCRequestParams,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): Promise<JSONRPCResponseResult> => {
          const { p, resolveP } = utils.promise<void>();
          if (ctx.signal.aborted) resolveP();
          ctx.signal.addEventListener(
            'abort',
            () => {
              resolveP();
            },
            { once: true },
          );
          await p;
          return input;
        };
      }
      const rpcServer = new RPCServer({
        timeoutTime: 500,
        logger,
        idGen,
      });
      await rpcServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
      });
      rpcServer.handleStream({
        ...serverPair,
        cancel: () => {},
      });

      let aborted = false;
      const rpcClient = new RPCClient({
        manifest: {
          testMethod: new UnaryCaller(),
        },
        streamFactory: async () => {
          return {
            ...clientPair,
            cancel: () => {
              aborted = true;
            },
          };
        },
        timeoutTime: 500,
        graceTime: 1000,
        logger,
        idGen,
      });

      const result = await rpcClient.methods.testMethod(value);
      if (result.metadata != null && result.metadata.timeout === null) {
        result.metadata.timeout = Infinity;
      }
      expect(result).toEqual(value);
      expect(aborted).toBeFalse();
      await rpcServer.stop({ force: true });
    },
  );
  test.prop({
    value: rpcTestUtils.safeJsonValueArb,
    error: rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
  })('RPC handles and sends errors', async ({ value, error }) => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    class TestMethod extends UnaryHandler {
      public handle = async (
        _input: JSONObject,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONObject> | undefined,
        _ctx: ContextTimed,
      ): Promise<JSONObject> => {
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
    rpcServer.handleStream({ ...serverPair, cancel: () => {} });

    const rpcClient = new RPCClient({
      manifest: {
        testMethod: new UnaryCaller(),
      },
      streamFactory: async () => {
        return { ...clientPair, cancel: () => {} };
      },
      logger,
      idGen,
    });

    // Create a new promise, so we can await it multiple times for assertions
    const callProm = rpcClient.methods.testMethod({ value });

    // The promise should be rejected
    const rejection = await callProm.catch((e) => e);

    // The error should have specific properties
    expect(rejection.cause).toBeInstanceOf(error.constructor);
    expect(rejection.cause).toEqual(error);

    // Cleanup
    await rpcServer.stop({ force: true });
  });
  test('middleware can end stream early', async () => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        input: AsyncIterableIterator<JSONObject>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): AsyncIterableIterator<JSONObject> {
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
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
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
    await expect(rpcServer.stop({ force: false })).toResolve();
  });
  test.prop({
    inputData: rpcTestUtils.safeJsonValueArb,
  })('RPC client and server timeout concurrently', async ({ inputData }) => {
    let serverTimedOut = false;
    let clientTimedOut = false;

    // Setup server and client communication pairs
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    const timeout = 1;
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        _input: AsyncIterableIterator<JSONObject>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncIterableIterator<JSONObject> {
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
    const rpcServer = new RPCServer({
      logger,
      idGen,
      timeoutTime: timeout,
    });
    await rpcServer.start({
      manifest: {
        testMethod: testMethodInstance,
      },
    });
    // Register callback
    rpcServer.registerOnTimeoutCallback(() => {
      serverTimedOut = true;
    });
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
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
    await expect(writer.write({ value: inputData })).rejects.toThrow(
      'Timed out waiting for header',
    );

    await expect(reader.read()).rejects.toThrow('Timed out waiting for header');

    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      inputData: rpcTestUtils.safeJsonValueArb,
    },
    { numRuns: 1 },
  )('RPC server times out before client', async ({ inputData }) => {
    let serverTimedOut = false;

    // Setup server and client communication pairs
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    // Define the server's method behavior
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        _input: AsyncIterableIterator<JSONObject>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
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
    const rpcServer = new RPCServer({
      logger,
      idGen,
      timeoutTime: 1,
    });
    await rpcServer.start({ manifest: { testMethod: new TestMethod({}) } });
    // Register callback
    rpcServer.registerOnTimeoutCallback(() => {
      serverTimedOut = true;
    });
    rpcServer.handleStream({ ...serverPair, cancel: () => {} });

    // Create an instance of the RPC client with a longer timeout
    const rpcClient = new RPCClient({
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
    await expect(writer.write({ value: inputData })).rejects.toThrow(
      'Timed out waiting for header',
    );
    await expect(reader.read()).rejects.toThrow('Timed out waiting for header');

    // Cleanup
    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      value: rpcTestUtils.safeJsonValueArb,
    },
    { numRuns: 1 },
  )('RPC client times out before server', async ({ value }) => {
    // Setup server and client communication pairs
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();
    class TestMethod extends DuplexHandler {
      public handle = async function* (
        _input: AsyncIterableIterator<JSONObject>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): AsyncIterableIterator<JSONObject> {
        ctx.signal.throwIfAborted();
        const abortProm = utils.promise<never>();
        ctx.signal.addEventListener('abort', () => {
          abortProm.rejectP(ctx.signal.reason);
        });
        await abortProm.p;
      };
    }
    // Set up a client and server with matching timeout settings
    const rpcServer = new RPCServer({
      logger,
      idGen,
      timeoutTime: 400,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
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
      timer: 300,
    });
    const writer = callerInterface.writable.getWriter();
    const reader = callerInterface.readable.getReader();
    // Expect the client to time out first
    await expect(writer.write({ value })).toResolve();
    await expect(reader.read()).toReject();

    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      inputData: rpcTestUtils.safeJsonValueArb,
    },
    { numRuns: 1 },
  )('RPC client and server with infinite timeout', async ({ inputData }) => {
    // Set up a client and server with infinite timeout settings

    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    class TestMethod extends DuplexHandler {
      public handle = async function* (
        _input: AsyncIterableIterator<JSONObject>,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
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
    const rpcServer = new RPCServer({
      logger,
      idGen,
      timeoutTime: Infinity,
    });
    await rpcServer.start({ manifest: { testMethod: new TestMethod({}) } });
    rpcServer.handleStream({ ...serverPair, cancel: () => {} });

    const rpcClient = new RPCClient({
      manifest: { testMethod: new DuplexCaller() },
      streamFactory: async () => ({ ...clientPair, cancel: () => {} }),
      logger,
      idGen,
    });

    const callerTimer = new Timer(() => {}, Infinity);

    const callerInterface = await rpcClient.methods.testMethod({
      timer: callerTimer,
    });

    const writer = callerInterface.writable.getWriter();
    const reader = callerInterface.readable.getReader();

    // Trigger a call that will hang indefinitely or for a long time

    // Write a value to the stream
    await writer.write({ value: inputData });

    // Trigger a read that will hang indefinitely

    const readPromise = reader.read();
    // Adding a randomized sleep here to check that neither timeout
    const randomSleepTime = Math.floor(Math.random() * 1000) + 1;
    // Random time between 1 and 1,000 ms
    await utils.sleep(randomSleepTime);
    // At this point, writePromise and readPromise should neither be resolved nor rejected
    // because the server method is hanging.

    // Check if the promises are neither resolved nor rejected
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject('timeout'), 1000),
    );

    // Check if read status is still pending;

    await expect(Promise.race([readPromise, timeoutPromise])).rejects.toBe(
      'timeout',
    );

    // Cancel caller timer
    callerTimer.cancel();

    // Expect neither to time out and verify that they can still handle other operations
    await rpcServer.stop({ force: true });
  });
  test('RPC server times out using client timeout', async () => {
    // Setup server and client communication pairs
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();
    const { p: ctxP, resolveP: resolveCtxP } = utils.promise<ContextTimed>();
    class TestMethod extends UnaryHandler {
      public handle = async (
        _input: JSONObject,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): Promise<JSONObject> => {
        const abortProm = utils.promise<never>();
        ctx.signal.addEventListener('abort', () => {
          resolveCtxP(ctx);
          abortProm.resolveP(ctx.signal.reason);
        });
        throw await abortProm.p;
      };
    }
    // Set up a client and server with matching timeout settings
    const rpcServer = new RPCServer({
      logger,
      idGen,
      timeoutTime: 150,
    });
    await rpcServer.start({
      manifest: {
        testMethod: new TestMethod({}),
      },
    });
    rpcServer.handleStream({
      ...serverPair,
      cancel: () => {},
    });

    const rpcClient = new RPCClient({
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
    await expect(rpcClient.methods.testMethod({}, { timer: 100 })).toReject();
    await expect(ctxP).resolves.toHaveProperty(['timer', 'delay'], 100);

    await rpcServer.stop({ force: true });
  });
  test.prop(
    {
      message: fc.string(),
    },
    { numRuns: 1 },
  )(
    'RPC client times out and server is able to ignore exception',
    async ({ message }) => {
      // Setup server and client communication pairs
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();
      const { p: ctxP, resolveP: resolveCtxP } = utils.promise<ContextTimed>();
      class TestMethod extends UnaryHandler {
        public handle = async (
          input: JSONObject,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          ctx: ContextTimed,
        ): Promise<JSONObject> => {
          const abortProm = utils.promise<never>();
          ctx.signal.addEventListener('abort', () => {
            resolveCtxP(ctx);
            abortProm.resolveP(ctx.signal.reason);
          });
          await abortProm.p;
          return input;
        };
      }
      // Set up a client and server with matching timeout settings
      const rpcServer = new RPCServer({
        logger,
        idGen,
        timeoutTime: 150,
      });
      await rpcServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
      });
      rpcServer.handleStream({
        ...serverPair,
        cancel: () => {},
      });

      const rpcClient = new RPCClient({
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
      await expect(
        rpcClient.methods.testMethod({ value: message }, { timer: 100 }),
      ).resolves.toHaveProperty('value', message);
      await expect(ctxP).resolves.toHaveProperty(['timer', 'delay'], 100);

      await rpcServer.stop({ force: true });
    },
  );
  test.prop({
    error: rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
  })('RPC Serializes and Deserializes Error', async ({ error }) => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    class TestMethod extends UnaryHandler {
      public handle = async (
        _input: JSONObject,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        _ctx: ContextTimed,
      ): Promise<JSONObject> => {
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
    rpcServer.handleStream({ ...serverPair, cancel: () => {} });

    const rpcClient = new RPCClient({
      manifest: {
        testMethod: new UnaryCaller(),
      },
      streamFactory: async () => {
        return { ...clientPair, cancel: () => {} };
      },
      logger,
      idGen,
    });

    const callProm = rpcClient.methods.testMethod({});
    const callError = await callProm.catch((e) => e);
    await expect(callProm).rejects.toThrow(rpcErrors.ErrorRPCRemote);
    expect(callError.cause).toEqual(error);

    await rpcServer.stop({ force: true });
  });
  test.prop({
    error: rpcTestUtils.errorArb(rpcTestUtils.errorArb()),
  })(
    'RPC Serializes and Deserializes Error with Custom Replacer Function',
    async ({ error }) => {
      const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
        Uint8Array,
        Uint8Array
      >();

      class TestMethod extends UnaryHandler {
        public handle = async (
          _input: JSONObject,
          _cancel: (reason?: any) => void,
          _meta: Record<string, JSONValue> | undefined,
          _ctx: ContextTimed,
        ): Promise<JSONObject> => {
          throw error;
        };
      }
      const rpcServer = new RPCServer({
        logger,
        idGen,
        replacer: filterSensitive('stack'),
      });
      await rpcServer.start({
        manifest: {
          testMethod: new TestMethod({}),
        },
      });
      rpcServer.handleStream({ ...serverPair, cancel: () => {} });

      const rpcClient = new RPCClient({
        manifest: {
          testMethod: new UnaryCaller(),
        },
        streamFactory: async () => {
          return { ...clientPair, cancel: () => {} };
        },
        logger,
        idGen,
      });

      const callProm = rpcClient.methods.testMethod({});
      const callError = await callProm.catch((e) => e);

      await expect(callProm).rejects.toThrow(rpcErrors.ErrorRPCRemote);
      expect(callError.cause).toEqual(error);

      await rpcServer.stop({ force: true });
    },
  );
  test('RPCServer force stop will propagate correct errors', async () => {
    const { clientPair, serverPair } = rpcTestUtils.createTapPairs<
      Uint8Array,
      Uint8Array
    >();

    const errorMessage = 'test error';

    const testReason = Error(errorMessage);

    class TestMethod extends UnaryHandler {
      public handle = async (
        _input: JSONObject,
        _cancel: (reason?: any) => void,
        _meta: Record<string, JSONValue> | undefined,
        ctx: ContextTimed,
      ): Promise<JSONObject> => {
        const abortP = utils.promise<void>();
        ctx.signal.addEventListener(
          'abort',
          () => abortP.resolveP(ctx.signal.reason),
          { once: true },
        );
        throw await abortP.p;
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
    rpcServer.handleStream({ ...serverPair, cancel: () => {} });

    const rpcClient = new RPCClient({
      manifest: {
        testMethod: new UnaryCaller(),
      },
      streamFactory: async () => {
        return { ...clientPair, cancel: () => {} };
      },
      logger,
      idGen,
    });

    const testProm = rpcClient.methods.testMethod({});

    await rpcServer.stop({ force: true, reason: testReason });
    const rejection = await testProm.catch((e) => e);
    expect(rejection).toBeInstanceOf(ErrorRPCRemote);
    expect(rejection.cause).toBeInstanceOf(Error);
    expect(rejection.cause.message).toBe(errorMessage);
  });
});
