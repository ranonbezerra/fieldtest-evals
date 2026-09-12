declare module 'supertest' {
  import { Server } from 'http';
  export default function request(app: Server): {
    get(url: string): any;
    post(url: string): any;
    patch(url: string): any;
    delete(url: string): any;
    set(header: string, value: string): any;
    send(body: any): any;
    expect(status: number): Promise<any>;
  };
}
