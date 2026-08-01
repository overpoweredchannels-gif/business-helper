import {
  ProductMemory,
  CustomerMemory,
  SupplierMemory,
  StaffMemory,
  FuzzyMatchResult,
} from "../contracts/memory";
import { fuzzySearch, normalizeForSearch } from "./fuzzy-match";

export class EntityIndex {
  private productsByName: Map<string, string[]> = new Map();
  private customersByName: Map<string, string[]> = new Map();
  private suppliersByName: Map<string, string[]> = new Map();
  private staffByName: Map<string, string[]> = new Map();

  private allProducts: ProductMemory[] = [];
  private allCustomers: CustomerMemory[] = [];
  private allSuppliers: SupplierMemory[] = [];
  private allStaff: StaffMemory[] = [];

  buildIndex(
    products: Map<string, ProductMemory>,
    customers: Map<string, CustomerMemory>,
    suppliers: Map<string, SupplierMemory>,
    staff: Map<string, StaffMemory>
  ): void {
    this.productsByName = new Map();
    this.customersByName = new Map();
    this.suppliersByName = new Map();
    this.staffByName = new Map();

    this.allProducts = Array.from(products.values());
    this.allCustomers = Array.from(customers.values());
    this.allSuppliers = Array.from(suppliers.values());
    this.allStaff = Array.from(staff.values());

    for (const p of this.allProducts) {
      const key = normalizeForSearch(p.name);
      const existing = this.productsByName.get(key) || [];
      existing.push(p.id);
      this.productsByName.set(key, existing);
    }
    for (const c of this.allCustomers) {
      const key = normalizeForSearch(c.name);
      const existing = this.customersByName.get(key) || [];
      existing.push(c.id);
      this.customersByName.set(key, existing);
    }
    for (const s of this.allSuppliers) {
      const key = normalizeForSearch(s.name);
      const existing = this.suppliersByName.get(key) || [];
      existing.push(s.id);
      this.suppliersByName.set(key, existing);
    }
    for (const s of this.allStaff) {
      const key = normalizeForSearch(s.name);
      const existing = this.staffByName.get(key) || [];
      existing.push(s.id);
      this.staffByName.set(key, existing);
    }
  }

  searchProducts(query: string, threshold = 0.5, maxResults = 5): FuzzyMatchResult<ProductMemory>[] {
    return fuzzySearch(query, this.allProducts, (p) => p.name, { threshold, maxResults });
  }

  searchCustomers(query: string, threshold = 0.5, maxResults = 5): FuzzyMatchResult<CustomerMemory>[] {
    return fuzzySearch(query, this.allCustomers, (c) => c.name, { threshold, maxResults });
  }

  searchSuppliers(query: string, threshold = 0.5, maxResults = 5): FuzzyMatchResult<SupplierMemory>[] {
    return fuzzySearch(query, this.allSuppliers, (s) => s.name, { threshold, maxResults });
  }

  searchStaff(query: string, threshold = 0.5, maxResults = 5): FuzzyMatchResult<StaffMemory>[] {
    return fuzzySearch(query, this.allStaff, (s) => s.name, { threshold, maxResults });
  }

  searchProductsByField(query: string, field: "name" | "brand", threshold = 0.5, maxResults = 5): FuzzyMatchResult<ProductMemory>[] {
    if (field === "name") return this.searchProducts(query, threshold, maxResults);
    return fuzzySearch(query, this.allProducts, (p) => p.brand || "", { threshold, maxResults });
  }

  findExactProduct(name: string): ProductMemory | undefined {
    const key = normalizeForSearch(name);
    const ids = this.productsByName.get(key);
    if (ids && ids.length > 0) {
      return this.allProducts.find((p) => p.id === ids[0]);
    }
    return undefined;
  }

  findExactCustomer(name: string): CustomerMemory | undefined {
    const key = normalizeForSearch(name);
    const ids = this.customersByName.get(key);
    if (ids && ids.length > 0) {
      return this.allCustomers.find((c) => c.id === ids[0]);
    }
    return undefined;
  }

  findExactSupplier(name: string): SupplierMemory | undefined {
    const key = normalizeForSearch(name);
    const ids = this.suppliersByName.get(key);
    if (ids && ids.length > 0) {
      return this.allSuppliers.find((s) => s.id === ids[0]);
    }
    return undefined;
  }

  clear(): void {
    this.productsByName.clear();
    this.customersByName.clear();
    this.suppliersByName.clear();
    this.staffByName.clear();
    this.allProducts = [];
    this.allCustomers = [];
    this.allSuppliers = [];
    this.allStaff = [];
  }
}
