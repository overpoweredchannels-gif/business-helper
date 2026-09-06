export type PerformanceSale = {
  id: string; invoice_number: string; sale_date: string | null; created_at: string;
  customer_id: string | null; total_amount: number | null; status: string | null;
  customers: { customer_name: string; shop_name: string | null } | null;
  sales_items: Array<{ quantity: number; selling_price: number; discount: number | null;
    products: { name: string; brand_id: string | null; brands: { name: string } | null } | null }>;
};
export function filterPerformance(sales: PerformanceSale[], filters: { from: string; to: string; customer: string; brand: string }) {
  return sales.filter(sale => {
    const date = (sale.sale_date || sale.created_at).slice(0, 10);
    return !["cancelled", "void", "draft", "pending_approval"].includes(sale.status ?? "")
      && (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
      && (!filters.customer || sale.customer_id === filters.customer)
      && (!filters.brand || sale.sales_items.some(item => item.products?.brand_id === filters.brand));
  });
}
export function performanceAmount(sale: PerformanceSale, brand: string) {
  if (!brand) return Number(sale.total_amount ?? 0);
  return sale.sales_items.filter(item => item.products?.brand_id === brand)
    .reduce((total, item) => total + Number(item.quantity) * Number(item.selling_price) - Number(item.discount ?? 0), 0);
}
