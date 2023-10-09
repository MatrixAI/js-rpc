import type {
  ErrorRPCConnectionLocal,
  ErrorRPCConnectionPeer,
  ErrorRPCConnectionKeepAliveTimeOut,
  ErrorRPCConnectionInternal,
} from './errors';
import { AbstractEvent } from '@matrixai/events';

abstract class EventRPCClient<T = null> extends AbstractEvent<T> {}

abstract class EventRPCServer<T = null> extends AbstractEvent<T> {}

abstract class EventRPCConnection<T = null> extends AbstractEvent<T> {}

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
  EventRPCClient,
  EventRPCServer,
  EventRPCConnection,
  EventRPCServerError,
  EventRPCConnectionError,
  EventRPCServerStopping,
  EventRPCServerStopped,
  EventRPCServerStart,
  EventRPCServerStarted,
};
