import { HttpRoute } from '@parallax/shared/types/http';
import path from 'path';
import { Glob } from '@parallax/shared/utils';

interface NextJsRouteParser {
  parsePagesRoutes(pagesDir: string): Promise<HttpRoute[]>;
  parseAppRoutes(appDir: string): Promise<HttpRoute[]>;
}

export class NextJsRouteParserImpl implements NextJsRouteParser {
  private filterNonRouteMethods(fileContent: string): string[] {
    const nonRouteMethods = ['console.error', 'headers.set'];
    const allMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    
    return allMethods.filter(method => {
      const methodPattern = new RegExp(`\b${method.toLowerCase()}\b`, 'i');
      return methodPattern.test(fileContent) && !nonRouteMethods.some(nonRoute => fileContent.includes(nonRoute));
    });
  }
  
  async parsePagesRoutes(pagesDir: string): Promise<HttpRoute[]> {
    const routes: HttpRoute[] = [];
    const files = await Glob({ pattern: '**/*.{js,ts}', path: pagesDir });
    
    for (const file of files) {
      const relativePath = path.relative(pagesDir, file);
      const routePath = relativePath
        .replace(/\.tsx?$/, '')
        .replace(/\/index$/, '')
        .replace(/\/api\//, '/');
      
      routes.push({
        path: `/api/${routePath}`,
        methods: this.filterNonRouteMethods(file),
        source: file,
      });
    }
    
    return routes;
  }

  async parseAppRoutes(appDir: string): Promise<HttpRoute[]> {
    const routes: HttpRoute[] = [];
    const files = await Glob({ pattern: '**/route.{js,ts}', path: appDir });
    
    for (const file of files) {
      const relativePath = path.relative(appDir, file);
      const routePath = relativePath
        .replace(/\/route\.tsx?$/, '')
        .replace(/\/index$/, '');
      
      routes.push({
        path: `/${routePath}`,
        methods: this.filterNonRouteMethods(file),
        source: file,
      });
    }
    
    return routes;
  }
}