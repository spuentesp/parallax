// Frontend API client for testing cross-boundary tracing
import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';

export async function getOrder(id: string) {
  // This should create a client_call → contract trace
  const response = await axios.get(`${API_BASE}/orders/${id}`);
  return response.data;
}

export async function processOrder(id: string) {
  // This should create another client_call → contract trace
  const response = await axios.post(`${API_BASE}/orders/${id}/process`);
  return response.data;
}

export function displayOrder(order: any) {
  // This should be the sink in the trace
  console.log('Displaying order:', order);
  return {
    rendered: true,
    orderId: order.id
  };
}