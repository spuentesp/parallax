export interface RpcIdentity {
  id: string;
  type: 'grpc' | 'rust' | 'semantic';
  serviceName: string;
  version?: string;
  methods?: string[];
  semanticRoute?: string;
}

export interface OpenShellRpcIdentity extends RpcIdentity {
  type: 'grpc';
  protoFile?: string;
  packageName?: string;
}

export interface RustRpcIdentity extends RpcIdentity {
  type: 'rust';
  tonicVersion?: string;
  protoPackage?: string;
}

export interface SemanticRpcIdentity extends RpcIdentity {
  type: 'semantic';
  semanticRoute: string;
  description?: string;
}

// Helper type to determine the specific RpcIdentity type based on the 'type' field
export type SpecificRpcIdentity<T extends RpcIdentity['type']> = T extends 'grpc'
  ? OpenShellRpcIdentity
  : T extends 'rust'
  ? RustRpcIdentity
  : T extends 'semantic'
  ? SemanticRpcIdentity
  : never;
