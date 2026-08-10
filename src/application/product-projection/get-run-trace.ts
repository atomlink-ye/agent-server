import type { ProductProjectionApi } from './product-projection.js';

export class GetRunTrace {
  public constructor(private readonly projection: ProductProjectionApi) {}

  public execute(input: Parameters<ProductProjectionApi['getRunTrace']>[0]) {
    return this.projection.getRunTrace(input);
  }
}
