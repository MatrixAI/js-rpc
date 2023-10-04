import type RPCServer from './RPCServer';
import type RPCClient from './RPCClient';
import type {
  ErrorRPCConnectionLocal,
  ErrorRPCConnectionPeer,
  ErrorRPCConnectionKeepAliveTimeOut,
  ErrorRPCConnectionInternal,
} from './errors';
import { AbstractEvent } from '@matrixai/events';
import * as rpcErrors from './errors';

abstract class EventRPC<T = null> extends AbstractEvent<T> {}

abstract class EventRPCClient<T = null> extends AbstractEvent<T> {}

abstract class EventRPCServer<T = null> extends AbstractEvent<T> {}

abstract class EventRPCConnection<T = null> extends AbstractEvent<T> {}

// Client events
class EventRPCClientDestroy extends EventRPCClient {}

class EventRPCClientDestroyed extends EventRPCClient {}

class EventRPCClientCreate extends EventRPCClient {}

class EventRPCClientCreated extends EventRPCClient {}

class EventRPCClientError extends EventRPCClient<Error> {}

class EventRPCClientConnect extends EventRPCClient {}

// Server events

class EventRPCServerConnection extends EventRPCServer<RPCServer> {}

class EventRPCServerStart extends EventRPCServer {}

class EventRPCServerStarted extends EventRPCServer {}

class EventRPCServerStopping extends EventRPCServer {}

class EventRPCServerStopped extends EventRPCServer {}

class EventRPCServerError extends EventRPCServer<Error> {}

class EventRPCConnectionError extends EventRPCConnection<
  | ErrorRPCConnectionLocal<unknown>
  | ErrorRPCConnectionPeer<unknown>
  | ErrorRPCConnectionKeepAliveTimeOut<unknown>
  | ErrorRPCConnectionInternal<unknown>
> {}

class RPCErrorEvent extends Event {
  public detail: Error;
  constructor(
    options: EventInit & {
      detail: Error;
    },
  ) {
    super('error', options);
    this.detail = options.detail;
  }
}

export {
  RPCErrorEvent,
  EventRPC,
  EventRPCClient,
  EventRPCServer,
  EventRPCConnection,
  EventRPCClientDestroy,
  EventRPCClientDestroyed,
  EventRPCClientCreate,
  EventRPCClientCreated,
  EventRPCClientError,
  EventRPCClientConnect,
  EventRPCServerConnection,
  EventRPCServerError,
  EventRPCConnectionError,
  EventRPCServerStopping,
  EventRPCServerStopped,
  EventRPCServerStart,
  EventRPCServerStarted,
};
