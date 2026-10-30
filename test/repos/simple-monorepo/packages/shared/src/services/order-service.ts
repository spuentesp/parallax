// Test service for cross-boundary tracing
import { Database } from '../database';

export class OrderService {
  constructor(private db: Database) {}

  async getOrder(id: string) {
    // This should create a data_access → domain → api_handler trace
    const order = await this.db.getOrder(id);
    return this.enrichOrder(order);
  }

  async processOrder(id: string) {
    // This should create a cross-service RPC trace
    const order = await this.db.getOrder(id);
    const processed = this.processOrderData(order);
    await this.db.updateOrder(id, processed);
    return processed;
  }

  private enrichOrder(order: any) {
    // Domain logic
    return {
      ...order,
      enriched: true,
      processedAt: new Date().toISOString()
    };
  }

  private processOrderData(order: any) {
    // More domain logic
    return {
      ...order,
      status: 'processed',
      processed: true
    };
  }
}