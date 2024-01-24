import { fc, test } from '@fast-check/jest';
import { AsyncIterableX as AsyncIterable } from 'ix/asynciterable';
import { Timer } from '@matrixai/timer';
import * as rpcUtils from '@/utils';
import 'ix/add/asynciterable-operators/toarray';
import * as rpcErrors from '@/errors';
import * as rpcUtilsMiddleware from '@/middleware';
import * as rpcTestUtils from './utils';

describe('Middleware tests', () => {
  const noiseArb = fc
    .array(
      fc.uint8Array({ minLength: 5 }).map((array) => Buffer.from(array)),
      { minLength: 5 },
    )
    .noShrink();

  test.prop(
    {
      messages: rpcTestUtils.jsonMessagesArb,
    },
    {
      numRuns: 1000,
    },
  )('asd', async ({ messages }) => {
    const parsedStream = rpcTestUtils
      .messagesToReadableStream(messages)
      .pipeThrough(
        rpcUtilsMiddleware.binaryToJsonMessageStream(
          rpcUtils.parseJSONRPCMessage,
        ),
      ); // Converting back.

    const asd = await AsyncIterable.as(parsedStream).toArray();
    expect(asd).toEqual(messages);
  });
  test.prop(
    {
      messages: fc.array(
        rpcTestUtils.jsonRpcRequestMessageArb(fc.string({ minLength: 100 })),
        {
          minLength: 1,
        },
      ),
    },
    { numRuns: 1000 },
  )('Message size limit is enforced when parsing', async ({ messages }) => {
    const parsedStream = rpcTestUtils
      .messagesToReadableStream(messages)
      .pipeThrough(rpcTestUtils.binaryStreamToSnippedStream([10]))
      .pipeThrough(
        rpcUtilsMiddleware.binaryToJsonMessageStream(
          rpcUtils.parseJSONRPCMessage,
          50,
        ),
      );

    const doThing = async () => {
      for await (const _ of parsedStream) {
        // No touch, only consume
      }
    };
    await expect(doThing()).rejects.toThrow(rpcErrors.ErrorRPCMessageLength);
  });
  test.prop(
    {
      messages: rpcTestUtils.jsonMessagesArb,
      snippattern: rpcTestUtils.snippingPatternArb,
    },
    { numRuns: 1000 },
  )(
    'can parse json stream with random chunk sizes',
    async ({ messages, snippattern }) => {
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(rpcTestUtils.binaryStreamToSnippedStream(snippattern)) // Imaginary internet here
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        ); // Converting back.

      const asd = await AsyncIterable.as(parsedStream).toArray();
      expect(asd).toStrictEqual(messages);
    },
  );
  test.prop(
    {
      messages: rpcTestUtils.jsonMessagesArb,
      snippattern: rpcTestUtils.snippingPatternArb,
      noise: noiseArb,
    },
    { numRuns: 1000 },
  )('Will error on bad data', async ({ messages, snippattern, noise }) => {
    const parsedStream = rpcTestUtils
      .messagesToReadableStream(messages)
      .pipeThrough(rpcTestUtils.binaryStreamToSnippedStream(snippattern)) // Imaginary internet here
      .pipeThrough(rpcTestUtils.binaryStreamToNoisyStream(noise)) // Adding bad data to the stream
      .pipeThrough(
        rpcUtilsMiddleware.binaryToJsonMessageStream(
          rpcUtils.parseJSONRPCMessage,
        ),
      ); // Converting back.

    await expect(AsyncIterable.as(parsedStream).toArray()).rejects.toThrow(
      rpcErrors.ErrorRPCParse,
    );
  });
  test.prop({
    messages: rpcTestUtils.jsonMessagesArb,
    timeout: fc.integer({ min: 0 }),
  })(
    'timeoutMiddlewareServer should set ctx.timeout if timeout is lower',
    async ({ messages, timeout }) => {
      if (messages[0].params == null) messages[0].params = {};
      messages[0].params.metadata = { ...messages[0].params.metadata, timeout };
      const abortController = new AbortController();
      const timer = new Timer(undefined, Infinity);
      const ctx = {
        signal: abortController.signal,
        timer,
      };
      const timeoutMiddleware = rpcUtilsMiddleware.timeoutMiddlewareServer(
        ctx,
        () => {},
        {},
      );
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        ) // Converting back.
        .pipeThrough(timeoutMiddleware.forward);

      const asd = await AsyncIterable.as(parsedStream).toArray();
      expect(asd).toEqual(messages);
      expect(timer.delay).toBe(timeout);
      timer.cancel();
      await timer.catch(() => {});
    },
  );
  test.prop({
    messages: rpcTestUtils.jsonMessagesArb,
    timeout: fc.integer({ min: 1 }),
  })(
    'timeoutMiddlewareServer wont set ctx.timeout if timeout is higher',
    async ({ messages, timeout }) => {
      if (messages[0].params == null) messages[0].params = {};
      messages[0].params.metadata = { ...messages[0].params.metadata, timeout };
      const abortController = new AbortController();
      const timer = new Timer(undefined, 0);
      const ctx = {
        signal: abortController.signal,
        timer,
      };
      const timeoutMiddleware = rpcUtilsMiddleware.timeoutMiddlewareServer(
        ctx,
        () => {},
        {},
      );
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        ) // Converting back.
        .pipeThrough(timeoutMiddleware.forward);

      const asd = await AsyncIterable.as(parsedStream).toArray();
      expect(asd).toEqual(messages);
      expect(timer.delay).toBe(0);
      timer.cancel();
      await timer.catch(() => {});
    },
  );
  test.prop({
    messages: rpcTestUtils.jsonMessagesArb,
  })(
    'timeoutMiddlewareServer should set ctx.timeout if timeout is infinity/null',
    async ({ messages }) => {
      if (messages[0].params == null) messages[0].params = {};
      messages[0].params.metadata = {
        ...messages[0].params.metadata,
        timeout: Infinity,
      };
      const abortController = new AbortController();
      const timer = new Timer(undefined, Infinity);
      const ctx = {
        signal: abortController.signal,
        timer,
      };
      const timeoutMiddleware = rpcUtilsMiddleware.timeoutMiddlewareServer(
        ctx,
        () => {},
        {},
      );
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        )
        .pipeThrough(timeoutMiddleware.forward); // Converting back.

      const expectedMessages = [...messages];
      if (expectedMessages[0].params?.metadata != null) {
        expectedMessages[0].params.metadata.timeout = null;
      }
      const asd = await AsyncIterable.as(parsedStream).toArray();
      expect(asd).toEqual(expectedMessages);
      expect(timer.delay).toBe(Infinity);
      timer.cancel();
      await timer.catch(() => {});
    },
  );
  test.prop({
    messages: rpcTestUtils.jsonMessagesArb,
    timeout: fc.integer({ min: 0 }),
  })(
    'timeoutMiddlewareClient can encode ctx.timeout',
    async ({ messages, timeout }) => {
      const abortController = new AbortController();
      const timer = new Timer(undefined, timeout);
      const ctx = {
        signal: abortController.signal,
        timer,
      };
      const timeoutMiddleware = rpcUtilsMiddleware.timeoutMiddlewareClient(
        ctx,
        () => {},
        {},
      );
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        )
        .pipeThrough(timeoutMiddleware.forward); // Converting back.

      const expectedMessages = [...messages];
      if (expectedMessages[0].params == null) expectedMessages[0].params = {};
      expectedMessages[0].params.metadata = {
        ...expectedMessages[0].params.metadata,
        timeout,
      };
      const asd = await AsyncIterable.as(parsedStream).toArray();
      expect(asd).toEqual(expectedMessages);
      expect(timer.delay).toBe(timeout);
      timer.cancel();
      await timer.catch(() => {});
    },
  );
});
