export interface HttpSensorConfig {
  // Common HTTP sensor configuration
  port?: number;
  host?: string;
  // Next.js specific configuration
  nextJs?: {
    pagesDir?: string;
    appDir?: string;
  };
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

export interface HttpRoute {
  path: string;
  method: HttpMethod;
  handler: string;
  type: 'pages' | 'app' | 'express' | 'fastify';
}

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: any;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body?: any;
}
