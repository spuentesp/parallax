import { RpcIdentity } from '@parallax/shared/types/rpc';
import OpenShellGrpcSensor from '../sensors/grpc';
import RustTonicSensor from '../sensors/rust';

class ServiceReferenceManager {
  private static instance: ServiceReferenceManager;
  private grpcSensor: OpenShellGrpcSensor;
  private rustSensor: RustTonicSensor;

  private constructor() {
    this.grpcSensor = OpenShellGrpcSensor.getInstance();
    this.rustSensor = RustTonicSensor.getInstance();
  }

  public static getInstance(): ServiceReferenceManager {
    if (!ServiceReferenceManager.instance) {
      ServiceReferenceManager.instance = new ServiceReferenceManager();
    }
    return ServiceReferenceManager.instance;
  }

  public async listServiceReferences(): Promise<RpcIdentity[]> {
    // Implementation for listing all service references
    // This combines results from both gRPC and Rust/Tonic sensors
    const grpcServices = await this.grpcSensor.detectServices();
    const rustServices = await this.rustSensor.detectServices();

    return [...grpcServices, ...rustServices];
  }

  public async getServiceReference(serviceName: string): Promise<RpcIdentity | null> {
    // Implementation for getting a specific service reference
    // First try gRPC sensor, then Rust/Tonic sensor
    let service = await this.grpcSensor.resolveIdentity(serviceName);
    if (!service) {
      service = await this.rustSensor.resolveIdentity(serviceName);
    }
    return service;
  }
}

export default ServiceReferenceManager;
