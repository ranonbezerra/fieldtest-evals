declare module 'supertest' {
  import { Server } from 'http';

  type SuperTestMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';

  interface SuperTestResponse {
    status: number;
    headers: Record<string, string | string[]>;
    body: any;
    text: string;
    // allow any additional properties
    [key: string]: any;
  }

  interface SuperTest {
    get(path: string): SuperTestRequest;
    post(path: string): SuperTestRequest;
    put(path: string): SuperTestRequest;
    delete(path: string): SuperTestRequest;
    patch(path: string): SuperTestRequest;
    head(path: string): SuperTestRequest;
    options(path: string): SuperTestRequest;
  }

  interface SuperTestRequest {
    send(body?: any): Promise<SuperTestResponse>;
    expect(status: number): Promise<SuperTestResponse>;
    // allow chaining of other supertest methods if needed
    [key: string]: any;
  }

  const request: (server: Server | string) => SuperTest;
  export default request;
}
