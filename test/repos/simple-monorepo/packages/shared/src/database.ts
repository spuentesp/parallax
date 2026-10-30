// Test database for cross-boundary tracing

export class Database {
  async getOrder(id: string) {
    // Simulate database access
    return {
      id,
      customer: `customer-${id}`,
      items: [
        { product: 'product-1', quantity: 2 },
        { product: 'product-2', quantity: 1 }
      ],
      status: 'pending'
    };
  }

  async updateOrder(id: string, data: any) {
    // Simulate database write
    return { success: true, id };
  }
}