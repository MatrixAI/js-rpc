import type { ReadableStream, ReadableWritablePair } from 'stream/web';
import type { ContextTimed, ContextTimedInput } from '@matrixai/contexts';
import type { Caller } from './callers';
import type { RawCaller } from './callers';
import type { DuplexCaller } from './callers';
import type { ServerCaller } from './callers';
import type { ClientCaller } from './callers';
import type { UnaryCaller } from './callers';
import type Handler from './handlers/Handler';

/**
 * This is the type for the IdGenFunction. It is used to generate the request
 */
type IdGen = () => PromiseLike<string | number | null> | string | number | null;

/**
 * This is the JSON RPC request object. this is the generic message type used for the RPC.
 */
type JSONRPCRequestMessage<
  T extends JSONRPCRequestParams = JSONRPCRequestParams,
> = {
  /**
   * A String specifying the version of the JSON-RPC protocol. MUST be exactly "2.0"
   */
  jsonrpc: '2.0';
  /**
   * A String containing the name of the method to be invoked. Method names that begin with the word rpc followed by a
   *  period character (U+002E or ASCII 46) are reserved for rpc-internal methods and extensions and MUST NOT be used
   *  for anything else.
   */
  method: string;
  /**
   * A Structured value that holds the parameter values to be used during the invocation of the method.
   *  This member MAY be omitted.
   */
  params?: T;
  /**
   * An identifier established by the Client that MUST contain a String, Number, or NULL value if included.
   *  If it is not included it is assumed to be a notification. The value SHOULD normally not be Null [1] and Numbers
   *  SHOULD NOT contain fractional parts [2]
   */
  id: string | number | null;
};

/**
 * This is the JSON RPC notification object. this is used for a request that
 * doesn't expect a response.
 */
type JSONRPCRequestNotification<
  T extends JSONRPCRequestParams = JSONRPCRequestParams,
> = {
  /**
   * A String specifying the version of the JSON-RPC protocol. MUST be exactly "2.0"
   */
  jsonrpc: '2.0';
  /**
   * A String containing the name of the method to be invoked. Method names that begin with the word rpc followed by a
   *  period character (U+002E or ASCII 46) are reserved for rpc-internal methods and extensions and MUST NOT be used
   *  for anything else.
   */
  method: string;
  /**
   * A Structured value that holds the parameter values to be used during the invocation of the method.
   *  This member MAY be omitted.
   */
  params: T;
};

/**
 * This is the JSON RPC response result object. It contains the response data for a
 * corresponding request.
 */
type JSONRPCResponseSuccess<
  T extends JSONRPCResponseResult = JSONRPCResponseResult,
> = {
  /**
   * A String specifying the version of the JSON-RPC protocol. MUST be exactly "2.0".
   */
  jsonrpc: '2.0';
  /**
   * This member is REQUIRED on success.
   *  This member MUST NOT exist if there was an error invoking the method.
   *  The value of this member is determined by the method invoked on the Server.
   */
  result: JSONRPCResponseResult<T>;
  /**
   * This member is REQUIRED.
   *  It MUST be the same as the value of the id member in the Request Object.
   *  If there was an error in detecting the id in the Request object (e.g. Parse error/Invalid Request),
   *  it MUST be Null.
   */
  id: string | number | null;
};

/**
 * This is the JSON RPC response Error object. It contains any errors that have
 * occurred when responding to a request.
 */
type JSONRPCResponseFailed = {
  /**
   * A String specifying the version of the JSON-RPC protocol. MUST be exactly "2.0".
   */
  jsonrpc: '2.0';
  /**
   * This member is REQUIRED on error.
   *  This member MUST NOT exist if there was no error triggered during invocation.
   *  The value for this member MUST be an Object as defined in section 5.1.
   */
  error: JSONRPCResponseError;
  /**
   * This member is REQUIRED.
   *  It MUST be the same as the value of the id member in the Request Object.
   *  If there was an error in detecting the id in the Request object (e.g. Parse error/Invalid Request),
   *  it MUST be Null.
   */
  id: string | number | null;
};

type JSONRPCRequestMetadata = Partial<{
  timeout: number | null;
}>;

/**
 * `T` is the params you want to specify.
 *
 * `M` is the metadata you want to specify.
 *
 * Metadata can also be specified on `T.metadata`
 */
type JSONRPCRequestParams<
  T extends JSONObject = JSONObject,
  M extends JSONObject = JSONObject,
> = {
  metadata?: JSONObject &
    JSONRPCRequestMetadata &
    Omit<T['metadata'] & M, keyof JSONRPCRequestMetadata>;
} & Omit<T, 'metadata'>;

type JSONRPCResponseMetadata = Partial<{
  timeout: number | null;
}>;

/**
 * `T` is the result you want to specify.
 *
 * `M` is the metadata you want to specify.
 *
 * Metadata can also be specified on `T.metadata`
 */
type JSONRPCResponseResult<
  T extends JSONObject = JSONObject,
  M extends JSONObject = JSONObject,
> = {
  metadata?: JSONObject &
    JSONRPCResponseMetadata &
    Omit<T['metadata'] & M, keyof JSONRPCResponseMetadata>;
} & Omit<T, 'metadata'>;

/**
 * This is a JSON RPC error object, it encodes the error data for the JSONRPCResponseFailed object.
 */
type JSONRPCResponseError = {
  /**
   * A Number that indicates the error type that occurred.
   *  This MUST be an integer.
   */
  code: number;
  /**
   * A String providing a short description of the error.
   *  The message SHOULD be limited to a concise single sentence.
   */
  message: string;
  /**
   * A Primitive or Structured value that contains additional information about the error.
   *  This may be omitted.
   *  The value of this member is defined by the Server (e.g. detailed error information, nested errors etc.).
   */
  data?: JSONValue;
};

/**
 * This is the JSON RPC Request object. It can be a request message or
 * notification.
 */
type JSONRPCRequest<T extends JSONRPCRequestParams = JSONRPCRequestParams> =
  | JSONRPCRequestMessage<T>
  | JSONRPCRequestNotification<T>;

/**
 * This is a JSON RPC response object. It can be a response result or error.
 */
type JSONRPCResponse<T extends JSONRPCResponseResult = JSONRPCResponseResult> =
  | JSONRPCResponseSuccess<T>
  | JSONRPCResponseFailed;

/**
 * This is a JSON RPC Message object. This is top level and can be any kind of
 * message.
 */
type JSONRPCMessage<
  T extends JSONRPCRequestParams | JSONRPCResponseResult =
    | JSONRPCRequestParams
    | JSONRPCResponseResult,
> = JSONRPCRequest<T> | JSONRPCResponse<T>;

// Handler types
type HandlerImplementation<I, O> = (
  input: I,
  cancel: (reason?: any) => void,
  meta: Record<string, JSONValue> | undefined,
  ctx: ContextTimed,
) => O;

type RawHandlerImplementation = HandlerImplementation<
  [JSONRPCRequest, ReadableStream<Uint8Array>],
  Promise<[JSONRPCResponseResult | undefined, ReadableStream<Uint8Array>]>
>;

type DuplexHandlerImplementation<
  I extends JSONRPCRequestParams = JSONRPCRequestParams,
  O extends JSONRPCResponseResult = JSONRPCResponseResult,
> = HandlerImplementation<AsyncIterable<I>, AsyncIterable<O>>;

type ServerHandlerImplementation<
  I extends JSONRPCRequestParams = JSONRPCRequestParams,
  O extends JSONRPCResponseResult = JSONRPCResponseResult,
> = HandlerImplementation<I, AsyncIterable<O>>;

type ClientHandlerImplementation<
  I extends JSONRPCRequestParams = JSONRPCRequestParams,
  O extends JSONRPCResponseResult = JSONRPCResponseResult,
> = HandlerImplementation<AsyncIterable<I>, Promise<O>>;

type UnaryHandlerImplementation<
  I extends JSONRPCRequestParams = JSONRPCRequestParams,
  O extends JSONRPCResponseResult = JSONRPCResponseResult,
> = HandlerImplementation<I, Promise<O>>;

type ContainerType = Record<string, any>;

/**
 * This interface extends the `ReadableWritablePair` with a method to cancel
 * the connection. It also includes some optional generic metadata. This is
 * mainly used as the return type for the `StreamFactory`. But the interface
 * can be propagated across the RPC system.
 */
interface RPCStream<R, W, M extends POJO = POJO>
  extends ReadableWritablePair<R, W> {
  cancel: (reason?: any) => void;
  meta?: M;
}

/**
 * This is a factory for creating a `RPCStream` when making an RPC call.
 * The transport mechanism is a black box to the RPC system. So long as it is
 * provided as a RPCStream the RPC system should function. It is assumed that
 * the RPCStream communicates with an `RPCServer`.
 */
type StreamFactory = (
  ctx: ContextTimed,
) => PromiseLike<RPCStream<Uint8Array, Uint8Array>>;

/**
 * Middleware factory creates middlewares.
 * Each middleware is a pair of forward and reverse.
 * Each forward and reverse is a `ReadableWritablePair`.
 * The forward pair is used transform input from client to server.
 * The reverse pair is used to transform output from server to client.
 * FR, FW is the readable and writable types of the forward pair.
 * RR, RW is the readable and writable types of the reverse pair.
 * FW -> FR is the direction of data flow from client to server.
 * RW -> RR is the direction of data flow from server to client.
 */
type MiddlewareFactory<FR, FW, RR, RW> = (
  ctx: ContextTimed,
  cancel: (reason?: any) => void,
  meta: Record<string, JSONValue> | undefined,
) => {
  forward: ReadableWritablePair<FR, FW>;
  reverse: ReadableWritablePair<RR, RW>;
};

// Convenience callers

type UnaryCallerImplementation<
  I extends JSONRPCRequestParams = JSONRPCRequestParams,
  O extends JSONRPCResponseResult = JSONRPCResponseResult,
> = (parameters: I, ctx?: Partial<ContextTimedInput>) => Promise<O>;

type ServerCallerImplementation<
  I extends JSONRPCRequestParams = JSONRPCRequestParams,
  O extends JSONRPCResponseResult = JSONRPCResponseResult,
> = (
  parameters: I,
  ctx?: Partial<ContextTimedInput>,
) => Promise<ReadableStream<O>>;

type ClientCallerImplementation<
  I extends JSONRPCRequestParams = JSONRPCRequestParams,
  O extends JSONRPCResponseResult = JSONRPCResponseResult,
> = (
  ctx?: Partial<ContextTimedInput>,
) => Promise<{ output: Promise<O>; writable: WritableStream<I> }>;

type DuplexCallerImplementation<
  I extends JSONRPCRequestParams = JSONRPCRequestParams,
  O extends JSONRPCResponseResult = JSONRPCResponseResult,
> = (ctx?: Partial<ContextTimedInput>) => Promise<RPCStream<O, I>>;

type RawCallerImplementation = (
  headerParams: JSONValue,
  ctx?: Partial<ContextTimedInput>,
) => Promise<
  RPCStream<
    Uint8Array,
    Uint8Array,
    Record<string, JSONValue> & { result: JSONValue; command: string }
  >
>;

type ConvertDuplexCaller<T> = T extends DuplexCaller<infer I, infer O>
  ? DuplexCallerImplementation<I, O>
  : never;

type ConvertServerCaller<T> = T extends ServerCaller<infer I, infer O>
  ? ServerCallerImplementation<I, O>
  : never;

type ConvertClientCaller<T> = T extends ClientCaller<infer I, infer O>
  ? ClientCallerImplementation<I, O>
  : never;

type ConvertUnaryCaller<T> = T extends UnaryCaller<infer I, infer O>
  ? UnaryCallerImplementation<I, O>
  : never;

type ConvertCaller<T extends Caller> = T extends DuplexCaller
  ? ConvertDuplexCaller<T>
  : T extends ServerCaller
    ? ConvertServerCaller<T>
    : T extends ClientCaller
      ? ConvertClientCaller<T>
      : T extends UnaryCaller
        ? ConvertUnaryCaller<T>
        : T extends RawCaller
          ? RawCallerImplementation
          : never;

/**
 * Contains the handler Classes that defines the handling logic and types for the server handlers.
 */
type ServerManifest = Record<string, Handler>;

/**
 * Contains the Caller classes that defines the types for the client callers.
 */
type ClientManifest = Record<string, Caller>;

type HandlerType = 'DUPLEX' | 'SERVER' | 'CLIENT' | 'UNARY' | 'RAW';

type MapCallers<T extends ClientManifest> = {
  [K in keyof T]: ConvertCaller<T[K]>;
};

declare const brand: unique symbol;

type Opaque<K, T> = T & { readonly [brand]: K };

type JSONObject = { [key: string]: JSONValue };

type JSONValue =
  | JSONObject
  | Array<JSONValue>
  | readonly JSONValue[]
  | string
  | number
  | boolean
  | null
  | undefined;

type POJO = { [key: string]: any };

type PromiseDeconstructed<T> = {
  p: Promise<T>;
  resolveP: (value: T | PromiseLike<T>) => void;
  rejectP: (reason?: any) => void;
};

type HandlerTypes<T> = T extends Handler<
  infer Container,
  infer Input,
  infer Output
>
  ? {
      container: Container;
      input: Input;
      output: Output;
    }
  : never;

type FromError = (error: any) => JSONValue;

type ToError = (errorData: JSONValue, clientMetadata: JSONValue) => any;

export type {
  IdGen,
  JSONRPCRequestMessage,
  JSONRPCRequestNotification,
  JSONRPCResponseSuccess,
  JSONRPCResponseFailed,
  JSONRPCRequestMetadata,
  JSONRPCRequestParams,
  JSONRPCResponseMetadata,
  JSONRPCResponseResult,
  JSONRPCResponseError,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCMessage,
  HandlerImplementation,
  RawHandlerImplementation,
  DuplexHandlerImplementation,
  ServerHandlerImplementation,
  ClientHandlerImplementation,
  UnaryHandlerImplementation,
  ContainerType,
  RPCStream,
  StreamFactory,
  MiddlewareFactory,
  ServerManifest,
  ClientManifest,
  HandlerType,
  MapCallers,
  Opaque,
  JSONObject,
  JSONValue,
  POJO,
  PromiseDeconstructed,
  HandlerTypes,
  FromError,
  ToError,
};
