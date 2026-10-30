export interface Contract {
  id: string;
  name: string;
  terms: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractContext {
  [key: string]: any;
}

export interface ContractApplicationResult {
  success: boolean;
  message: string;
  preview?: Contract;
}
