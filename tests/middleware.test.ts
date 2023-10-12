import { fc, testProp } from '@fast-check/jest';
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

  testProp(
    'can parse json stream',
    [rpcTestUtils.jsonMessagesArb],
    async (messages) => {
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        ); // Converting back.

      const asd = await AsyncIterable.as(parsedStream).toArray();
      expect(asd).toEqual(messages);
    },
    { numRuns: 1000 },
  );
  testProp(
    'Message size limit is enforced when parsing',
    [
      fc.array(
        rpcTestUtils.jsonRpcRequestMessageArb(fc.string({ minLength: 100 })),
        {
          minLength: 1,
        },
      ),
    ],
    async (messages) => {
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
    },
    { numRuns: 1000 },
  );
  testProp(
    'can parse json stream with random chunk sizes',
    [rpcTestUtils.jsonMessagesArb, rpcTestUtils.snippingPatternArb],
    async (messages, snippattern) => {
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
    { numRuns: 1000 },
  );
  testProp(
    'Will error on bad data',
    [rpcTestUtils.jsonMessagesArb, rpcTestUtils.snippingPatternArb, noiseArb],
    async (messages, snippattern, noise) => {
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
    },
    { numRuns: 1000 },
  );
  testProp(
    'timeoutMiddlewareServer should set ctx.timeout if timeout is lower',
    [rpcTestUtils.jsonMessagesArb, fc.integer({ min: 0 })],
    async (messages, timeout) => {
      messages[0].metadata = { ...messages[0].metadata, timeout };
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
  testProp(
    'timeoutMiddlewareServer wont set ctx.timeout if timeout is higher',
    [rpcTestUtils.jsonMessagesArb, fc.integer({ min: 1 })],
    async (messages, timeout) => {
      messages[0].metadata = { ...messages[0].metadata, timeout };
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
  testProp(
    'timeoutMiddlewareServer should set ctx.timeout if timeout is infinity/null',
    [rpcTestUtils.jsonMessagesArb],
    async (messages) => {
      messages[0].metadata = { ...messages[0].metadata, timeout: Infinity };
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
      if (expectedMessages[0].metadata != null) {
        expectedMessages[0].metadata.timeout = null;
      }
      const asd = await AsyncIterable.as(parsedStream).toArray();
      expect(asd).toEqual(expectedMessages);
      expect(timer.delay).toBe(Infinity);
      timer.cancel();
      await timer.catch(() => {});
    },
  );
  testProp(
    'timeoutMiddlewareClient can encode ctx.timeout',
    [rpcTestUtils.jsonMessagesArb, fc.integer({ min: 0 })],
    async (messages, timeout) => {
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
      expectedMessages[0].metadata = {
        ...expectedMessages[0].metadata,
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
