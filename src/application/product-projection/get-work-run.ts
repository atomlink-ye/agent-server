import type { ProductProjectionApi } from './product-projection.js';

export class GetWorkRun {
  public constructor(private readonly projection: ProductProjectionApi) {}

  public execute(input: Parameters<ProductProjectionApi['getWorkRun']>[0]) {
    return this.projection.getWorkRun(input);
  }
}
