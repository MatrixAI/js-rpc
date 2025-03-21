import { fc, test } from '@fast-check/jest';
import { Timer } from '@matrixai/timer';
import * as rpcTestUtils from './utils.js';
import * as rpcUtils from '#utils.js';
import * as rpcErrors from '#errors.js';
import * as rpcUtilsMiddleware from '#middleware.js';

describe('Middleware tests', () => {
  const noiseArb = fc.array(
    fc.uint8Array({ minLength: 5 }).map((array) => Buffer.from(array)),
    { minLength: 5 },
  );

  test.prop({ messages: rpcTestUtils.jsonMessagesArb }, { numRuns: 1000 })(
    'converting to raw and back to JSON',
    async ({ messages }) => {
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        ); // Converting back.

      const messagesParsed = await rpcTestUtils.toArray(parsedStream);
      expect(messagesParsed).toEqual(messages);
    },
  );
  test.prop({ messages: rpcTestUtils.jsonMessagesArb }, { numRuns: 100 })(
    'header message is json while content is binary stream',
    async ({ messages }) => {
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonHeaderMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        );
      let first = true;
      for await (const chunk of parsedStream) {
        if (first) {
          // We can't check for types at runtime, especially a JSON type which
          // can have arbitrary fields.
          expect(chunk).not.toBeInstanceOf(Uint8Array);
          first = false;
          continue;
        }
        expect(chunk).toBeInstanceOf(Uint8Array);
      }
    },
  );
  test.prop(
    {
      messages: fc.array(
        rpcTestUtils.jsonRpcRequestMessageArb(fc.string({ minLength: 100 })),
        { minLength: 1 },
      ),
    },
    { numRuns: 1000 },
  )('message size limit is enforced when parsing', async ({ messages }) => {
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
      snipPattern: rpcTestUtils.snippingPatternArb,
    },
    { numRuns: 1000, verbose: true },
  )(
    'can parse json stream with random chunk sizes',
    async ({ messages, snipPattern: snipPattern }) => {
      const parsedStream = rpcTestUtils
        .messagesToReadableStream(messages)
        .pipeThrough(rpcTestUtils.binaryStreamToSnippedStream(snipPattern)) // Imaginary internet here
        .pipeThrough(
          rpcUtilsMiddleware.binaryToJsonMessageStream(
            rpcUtils.parseJSONRPCMessage,
          ),
        ); // Converting back.

      const messagesParsed = await rpcTestUtils.toArray(parsedStream);
      expect(messagesParsed).toStrictEqual(messages);
    },
  );
  test.prop(
    {
      messages: rpcTestUtils.jsonMessagesArb,
      snipPattern: rpcTestUtils.snippingPatternArb,
      noise: noiseArb,
    },
    { numRuns: 1000 },
  )('should error on bad data', async ({ messages, snipPattern, noise }) => {
    const parsedStream = rpcTestUtils
      .messagesToReadableStream(messages)
      .pipeThrough(rpcTestUtils.binaryStreamToSnippedStream(snipPattern)) // Imaginary internet here
      .pipeThrough(rpcTestUtils.binaryStreamToNoisyStream(noise)) // Adding bad data to the stream
      .pipeThrough(
        rpcUtilsMiddleware.binaryToJsonMessageStream(
          rpcUtils.parseJSONRPCMessage,
        ),
      ); // Converting back.

    await expect(rpcTestUtils.toArray(parsedStream)).rejects.toThrow(
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

      const messagesParsed = await rpcTestUtils.toArray(parsedStream);
      expect(messagesParsed).toEqual(messages);
      expect(timer.delay).toBe(timeout);
      timer.cancel();
      await timer.catch(() => {});
    },
  );
  test.prop({
    messages: rpcTestUtils.jsonMessagesArb,
    timeout: fc.integer({ min: 1 }),
  })(
    'timeoutMiddlewareServer will not set ctx.timeout if timeout is higher',
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

      const messagesParsed = await rpcTestUtils.toArray(parsedStream);
      expect(messagesParsed).toEqual(messages);
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
      const messagesParsed = await rpcTestUtils.toArray(parsedStream);
      expect(messagesParsed).toEqual(expectedMessages);
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
      const messagesParsed = await rpcTestUtils.toArray(parsedStream);
      expect(messagesParsed).toEqual(expectedMessages);
      expect(timer.delay).toBe(timeout);
      timer.cancel();
      await timer.catch(() => {});
    },
  );
});
