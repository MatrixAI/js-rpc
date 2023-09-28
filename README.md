# js-rpc

staging:[![pipeline status](https://gitlab.com/MatrixAI/open-source/js-rpc/badges/staging/pipeline.svg)](https://gitlab.com/MatrixAI/open-source/js-rpc/commits/staging)
master:[![pipeline status](https://gitlab.com/MatrixAI/open-source/js-rpc/badges/master/pipeline.svg)](https://gitlab.com/MatrixAI/open-source/js-rpc/commits/master)

## Installation

```sh
npm install --save @matrixai/rpc
```

## Usage
### Client Streaming
Duplex ->

```ts
{readable: ReadableStream<JSONValue>, writable: WritableStream<JSONValue>};
const reader = readable.getReader();
const writer = writable.getWriter();
Output = await reader.read();
```
## Usage Examples

Because decorators are experimental, you must enable: `"experimentalDecorators": true` in your `tsconfig.json` to use this library.

### Client Stream
In a Client Stream, the client can write multiple messages to a single stream,
while the server reads from that stream and then returns a single response.
This pattern is useful when the client needs to send a sequence of data to the server,
after which the server processes the data and replies with a single result.
This pattern is good for scenarios like file uploads.

This example shows how to create an RPC pair and handle streaming integers and summing them up.

```ts
import {RPCServer, ClientHandler, ContainerType, RPCClient, ClientCaller} from "./index";
import {AsyncIterable} from "ix/Ix";

const webSocketServer = awwait;

class Sum extends ClientHandler<ContainerType, number, number> {
  public handle = async (
    // handle takes input an AsyncIterable, which is a generator,
    // would produce numbers input in the Writeable stream
    input: AsyncIterable<number>,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): Promise<number> => {
    let sum = 0;
    for await (const num of input) {
      sum += num;
    }
    return acc;
  };
};

// Setting up an instance of RPC Client with Sum as the handler method
async function startServer() {

  const rpcServer = await RPCServer.createRPCServer({
    manifest: {
      Sum: new Sum({}),
    },
    logger,
    idGen,
    handlerTimeoutTime: 60000,
  });
  // Simulating receiving a stream from a client.
  // Provided by network layer
  const simulatedStream = sendStreamHere;

  rpcServer.handleStream(simulatedStream);
  return rpcServer;
}

async function startClient() {
  // Simulate client-server pair of streams.
  // Simulating network stream
  const clientPair =sendStreamHere /* your logic for creating or obtaining a client-side stream */;
  const rpcClient = await RPCClient.createRPCClient({
    manifest: {
      Sum: new ClientCaller<number, number>(),
    },
    streamFactory,
    middlewareFactory,
    logger,
    idGen
  })

  return rpcClient;
}
// Function to execute the Sum RPC call
async function executeSum(rpcClient: typeof RPCClient){
    const { output, writable } = await rpcClient.methods.Sum();
    const writer = writable.getWriter();
    await writer.write(5);
    await writer.write(10);
    await writer.close();

    const ans = await output;

    console.log('Sum is: $(ans)');
}
// Main function to tie everything together
async function main(){
    const rpcServer = await startServer();
    const rpcClient = await startClient();

    await executeSum(rpcClient);

    await rpcServer.destroy();
    await rpcClient.destroy();
}

main();
```
### Duplex Stream
A Duplex Stream enables both the client and the server to read
and write messages in their respective streams independently of each other.
Both parties can read and write multiple messages in any order.
It's useful in scenarios that require ongoing communication in both directions, like chat applications.

In this example, the client sends a sequence of numbers and the server responds with the squares of those numbers.
```ts
import { RPCServer, DuplexHandler, ContainerType } from "./index";

class SquareNumbersDuplex extends DuplexHandler<ContainerType, number, Array<number>> {
  public handle = async function* (
    input: AsyncIterableIterator<number>,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): AsyncIterableIterator<Array<number>> {
    for await (const num of input) {
      const squares: Array<number> = [];
      for (let i = 1; i <= num; i++) {
        squares.push(i * i);
      }
      yield squares;
    }
  };
}

async function startServer() {
  const rpcServer = await RPCServer.createRPCServer({
    manifest: {
      SquareNumbersDuplex: new SquareNumbersDuplex({}),
    },
    logger,
    idGen,
  });
  const simulatedStream = sendStreamHere/* your logic for creating or obtaining a server-side stream */;
  rpcServer.handleStream(simulatedStream);

  return rpcServer;
}

// Run the server
startServer();
import { RPCClient, DuplexCaller } from "./index";

async function startClient() {
  const rpcClient = await RPCClient.createRPCClient({
    manifest: {
      SquareNumbersDuplex: new DuplexCaller<number, Array<number>>(),
    },
    streamFactory,
    middlewareFactory,
    logger,
    idGen,
  });

  const squareStream = await rpcClient.methods.SquareNumbersDuplex();

  // Write to the server
  const writer = squareStream.writable.getWriter();
  writer.write(2);
  writer.write(3);
  writer.write(4);

  // Read squared numbers from the server
  for await (const squares of squareStream.readable) {
    console.log(`Squares up to n are: ${squares.join(", ")}`);
  }

  writer.close();

  return rpcClient;
}

// Run the client
startClient();
async function main(){
  const rpcServer = await startServer();
  const rpcClient = await startClient();

  await rpcServer.destroy();
  await rpcClient.destroy();
}

// Run the main function to kick off the example
main();

```
### Raw Stream

Raw Stream is designed for low-level handling of RPC calls, enabling granular control over data streaming.
Unlike other patterns, Raw Streams allow both the server and client to work directly with raw data,
providing a more flexible yet complex way to handle communications.
This is especially useful when the RPC protocol itself needs customization
or when handling different types of data streams within the same connection.

In this example, the client sends a sequence of numbers and the server responds with the factorial of each number.

```ts
import {RawHandler, JSONRPCRequest, ContextTimed, JSONValue} from '../types';
import {ContainerType} from "./types";
import RPCServer from "./RPCServer";  // Assuming these are imported correctly

class FactorialStream extends RawHandler<ContainerType> {
  public async handle(
    [request, inputStream]: [JSONRPCRequest, ReadableStream<Uint8Array>],
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): Promise<[JSONValue, ReadableStream<Uint8Array>]> {

    const {readable, writable} = new TransformStream<Uint8Array, Uint8Array>();

    (async () => {
      const reader = inputStream.getReader();
      const writer = writable.getWriter();
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          break;
        }

        const num = parseInt(new TextDecoder().decode(value), 10);
        const factorial = factorialOf(num).toString();
        const outputBuffer = new TextEncoder().encode(factorial);

        writer.write(outputBuffer);
      }
      writer.close();
    })();

    return ["Starting factorial computation", readable];
  }
}

function factorialOf(n: number): number {
  return (n === 0) ? 1 : n * factorialOf(n - 1);
}

async function startSErver() {
  const rpcServer = await RPCServer.createRPCServer({
    manifest: {
      FactorialStream: new FactorialStream({}),
    },
    logger,
    idGen,
  });

  const simulatedStream = sendStreamHere/* your logic for creating or obtaining a server-side stream */;
  rpcServer.handleStream(simulatedStream);
  return rpcServer;
}

async function startClient() {
  const rpcClient = await RPCClient.createRPCClient({
    manifest: {
      FactorialStream: new RawCaller(),
    },
    streamFactory,
    middlewareFactory,
    logger,
    idGen,
  });

  const { readable, writable, meta } = await rpcClient.methods.FactorialRaw({});


  //Printing 'Starting factorial computation'
  console.log(meta);


  const writer = writable.getWriter();

  const numbers = [1, 2, 3, 4, 5];

  for (const num of numbers){
      writer.write(new TextEncoder().encode(num.toString()));
  }
  writer.close();


  const reader = readable.getReader();
  while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      console.log('The factorial is: $(new TextDecoder().decode(value))');
  }
  return rpcClient;
}

async function main(){
  const rpcServer = await startServer();
  const rpcClient = await startClient();

  await rpcServer.destroy();
  await rpcClient.destroy();
}

// Run the main function to kick off the example
main();
```
### Server Stream
In Server Stream calls,
the client sends a single request and receives multiple responses in a read-only stream from the server.
The server can keep pushing messages as long as it needs, allowing real-time updates from the server to the client.
This is useful for things like monitoring,
where the server needs to update the client in real-time based on events or data changes.


In this example, the client sends a number and the server responds with the squares of all numbers up to that number.
```ts
import ServerHandler from "./ServerHandler";
import {ContainerType} from "./types";
import {AsyncIterable} from "ix/Ix";

class SquaredNums extends ServerHandler<ContainerType, number, number> {
  public handle = async function* (
    input: number,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): AsyncIterable<number>{
        for (let i = 0; i<= input; i++){
            yield i*i;
        }
  };
}

async function startServer() {

  const rpcServer = await RPCServer.createRPCServer({
    manifest: {
      SquaredNums: new SquaredNums({}),
    },
    logger,
    idGen,
    handlerTimeoutTime: 60000,
  });
  // Simulating receiving a stream from a client.
  // Provided by network layer
  const simulatedStream =sendStreamHere;

  rpcServer.handleStream(simulatedStream);
  return rpcServer;
}
async function startClient() {
  // Simulate client-server pair of streams.
  // Simulating network stream
  const clientPair = sendStreamHere/* your logic for creating or obtaining a client-side stream */;
  const rpcClient = await RPCClient.createRPCClient({
    manifest: {
        SquaredNums: new ServerCaller
    },
    streamFactory,
    middlewareFactory,
    logger,
    idGen
  })

  const squaredStream = await rpcClient.methods.SquaredNums(4);
  // Read squared numbers from the server
  const outputs: Array<number> = [];
  for await(const num of squaredStream) {
      outputs.push(num);
  }

  console.log('Squared numbers are: $(outputs.join(', ')}');

  return

  return rpcClient;
}

async function main(){
    const rpcServer = await startServer();
    const rpcClient = await startClient();

    await rpcServer.destroy();
    await rpcClient.destroy();
}

main();
```
### Unary Stream

In a Unary Stream, the client sends a single request to the server and gets a single response back,
just like HTTP/REST calls but over a connection.
It's the simplest form of RPC, suitable for short-lived operations that don't require streaming data.
It's the go-to choice for straightforward "request and response" interactions.

In this example, the client sends a number and the server responds with the square of that number.
```ts
class SquaredNumberUnary extends UnaryHandler<ContainerType, number, number> {
  public handle = async (
    input: number,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): Promise<number> => {
    return input * input;
  };
}

async function startServer() {
  const rpcServer = await RPCServer.createRPCServer({
    manifest: {
      SquaredNumberUnary: new SquaredNumberUnary({}),
    },
    logger,
    idGen,
  });
  const simulatedStream = sendStreamHere/* your logic for creating or obtaining a server-side stream */;
  rpcServer.handleStream(simulatedStream);

  return rpcServer;
}

async function startClient() {
  const rpcClient = await RPCClient.createRPCClient({
    manifest: {
      SquaredNumberUnary: new UnaryCaller<number, number>(),
    },
    streamFactory,
    middlewareFactory,
    logger,
    idGen,
  });
  const squaredNumber = await rpcClient.methods.SquaredNumberUnary(4);

  console.log('Squared number is: $(squaredNumber)');

  return rpcClient;
}

async function main(){
  const rpcServer = await startServer();
  const rpcClient = await startClient();

  await rpcServer.destroy();
  await rpcClient.destroy();
}

main();
```
## Development

Run `nix-shell`, and once you're inside, you can use:

```sh
# install (or reinstall packages from package.json)
npm install
# build the dist
npm run build
# run the repl (this allows you to import from ./src)
npm run ts-node
# run the tests
npm run test
# lint the source code
npm run lint
# automatically fix the source
npm run lintfix
```

### Docs Generation

```sh
npm run docs
```

See the docs at: https://matrixai.github.io/js-rpc/

### Publishing

Publishing is handled automatically by the staging pipeline.

Prerelease:

```sh
# npm login
npm version prepatch --preid alpha # premajor/preminor/prepatch
git push --follow-tags
```

Release:

```sh
# npm login
npm version patch # major/minor/patch
git push --follow-tags
```

Manually:

```sh
# npm login
npm version patch # major/minor/patch
npm run build
npm publish --access public
git push
git push --tags
```

Domains Diagram:
![diagram_encapuslated.svg](images%2Fdiagram_encapuslated.svg)
