"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface Brand {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  parent_category_id: string | null;
}

interface Product {
  id: number;
  name: string;
  brand_id: string | null;
  category_id: string | null;
  unit_type: string | null;
  last_purchase_price?: number | null;
  default_selling_price?: number | null;
  reorder_level?: number | null;
  track_batch?: boolean | null;
  track_expiry?: boolean | null;
}

interface Customer {
  id: string;
  customer_name: string;
  shop_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  area: string | null;
  customer_type: string | null;
  credit_policy: string | null;
  credit_limit: number | null;
  credit_days: number | null;
  allow_over_limit: boolean | null;
  allow_overdue_sales: boolean | null;
  preferred_payment_method: string | null;
}

interface Supplier {
  id: string;
  supplier_name: string;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  notes: string | null;
}

interface PurchaseTransaction {
  id: string;
  supplier_id: string;
  invoice_number: string;
  created_at: string;
  expense_review_status: string | null;
  expense_reviewed_at: string | null;
}

interface SalesTransaction {
  id: string;
  customer_id: string;
  invoice_number: string;
  created_at: string;
  sale_date: string | null;
  payment_type: string | null;
  credit_due_date: string | null;
  credit_limit_snapshot: number | null;
  credit_days_snapshot: number | null;
}

interface NewPurchaseExpenseReminder {
  id: string;
  invoiceNumber: string;
  supplierId: string;
}

interface PurchaseLine {
  id?: string;
  product_id: string | null;
  quantity: string;
  purchase_price: string;
  selling_price: string;
  batch_number: string;
  expiry_date: string;
}

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getMonthRange = (monthOffset = 0) => {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0);
  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  };
};

const getDateOnly = (dateValue: string | null | undefined) => {
  if (!dateValue) return null;
  return dateValue.slice(0, 10);
};

const isDateInRange = (dateValue: string | null | undefined, startDate: string, endDate: string) => {
  const dateOnly = getDateOnly(dateValue);
  if (!dateOnly) return false;
  if (startDate && dateOnly < startDate) return false;
  if (endDate && dateOnly > endDate) return false;
  return true;
};

const addDaysToDateInputValue = (dateValue: string, days: number) => {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
};

const safeNumber = (value: unknown) => {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

export default function Home() {
  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState("");
  const [unitsPerPack, setUnitsPerPack] = useState("");
  const [minimumStockLevel, setMinimumStockLevel] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [trackBatch, setTrackBatch] = useState(false);
  const [trackExpiry, setTrackExpiry] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [brandName, setBrandName] = useState("");
  const [brandMessage, setBrandMessage] = useState<string | null>(null);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(false);

  const [categoryName, setCategoryName] = useState("");
  const [parentCategoryId, setParentCategoryId] = useState<string | null>(null);
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [shopName, setShopName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [customerType, setCustomerType] = useState("Retailer");
  const [creditPolicy, setCreditPolicy] = useState("cash_only");
  const [creditLimit, setCreditLimit] = useState("");
  const [creditDays, setCreditDays] = useState("");
  const [allowOverLimit, setAllowOverLimit] = useState(false);
  const [allowOverdueSales, setAllowOverdueSales] = useState(false);
  const [customerMessage, setCustomerMessage] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  const [supplierName, setSupplierName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierWhatsapp, setSupplierWhatsapp] = useState("");
  const [supplierCity, setSupplierCity] = useState("");
  const [supplierNotes, setSupplierNotes] = useState("");
  const [supplierMessage, setSupplierMessage] = useState<string | null>(null);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");

  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([]);
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [purchaseTransactions, setPurchaseTransactions] = useState<PurchaseTransaction[]>([]);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [newPurchaseExpenseReminder, setNewPurchaseExpenseReminder] =
    useState<NewPurchaseExpenseReminder | null>(null);
  const [purchaseExpenseStatusMessage, setPurchaseExpenseStatusMessage] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [currentProfile, setCurrentProfile] = useState<any | null>(null);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    checkAuthUser();
  }, []);

  const fetchExpenses = async (organizationId: string) => {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching expenses:", error);
      return;
    }

    setExpenses(data ?? []);
  };

  const loadProfile = async (userId: string | null) => {
    if (!userId || typeof userId !== "string") {
      console.error("Invalid userId passed to loadProfile:", userId);
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
      return;
    }

    console.log("Loading profile for userId:", userId);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Profile load error details:", JSON.stringify(profileError, null, 2));
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
      setAuthError("Failed to load profile. Please try again.");
      return;
    }

    if (!profile) {
      console.error("No profile found for user:", userId);
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
      setAuthError("No profile found for this account. Please complete signup again or contact support.");
      return;
    }

    if (!profile.organization_id) {
      console.error("Profile has no organization_id for user:", userId);
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
      setAuthError("Profile is incomplete. Missing organization. Please contact support.");
      return;
    }

    console.log("Profile loaded successfully:", { userId, organizationId: profile.organization_id });
    setAuthError(null);
    setCurrentProfile(profile);
    setCurrentOrganizationId(profile.organization_id);
    fetchBrands(profile.organization_id);
    fetchCategories(profile.organization_id);
    fetchProducts(profile.organization_id);
    fetchCustomers(profile.organization_id);
    fetchSuppliers(profile.organization_id);
    fetchPurchaseTransactions(profile.organization_id);
    fetchSalesTransactions(profile.organization_id);
    fetchCustomerPayments(profile.organization_id);
    fetchCustomerPaymentAllocations(profile.organization_id);
    fetchSupplierPayments(profile.organization_id);
    fetchExpenses(profile.organization_id);
    fetchPurchaseItems();
    fetchSalesItems();
  };

  const checkAuthUser = async () => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error("Error checking auth session:", sessionError);
      setCurrentUser(null);
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
      return;
    }

    if (!sessionData?.session) {
      setCurrentUser(null);
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
      return;
    }

    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("Error fetching auth user:", error);
      setCurrentUser(null);
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
      return;
    }

    const user = data.user ?? null;
    setCurrentUser(user);
    if (user?.id) {
      await loadProfile(user.id);
    } else {
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
    }
  };

  const handleSignUp = async () => {
    setAuthError(null);
    setAuthMessage(null);
    setAuthLoading(true);

    if (!fullName.trim() || !organizationName.trim() || !email.trim() || !password.trim()) {
      setAuthError("Please fill in all signup fields.");
      setAuthLoading(false);
      return;
    }

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        throw signUpError;
      }

      const user = signUpData.user;
      if (!user) {
        throw new Error("Signup succeeded but no user was returned.");
      }

      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: organizationName })
        .select()
        .single();

      if (orgError) {
        throw orgError;
      }

      const organizationId = orgData?.id;
      if (!organizationId) {
        throw new Error("Failed to create organization.");
      }

      const { error: profileError } = await supabase.from("profiles").insert({
        id: user.id,
        organization_id: organizationId,
        full_name: fullName,
        role_name: "owner",
        is_active: true,
      });

      if (profileError) {
        throw profileError;
      }

      setAuthMessage("Account created successfully. Please verify your email if required.");
      setEmail("");
      setPassword("");
      setFullName("");
      setOrganizationName("");
      setCurrentUser(user);
      await loadProfile(user.id);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to create account");
      console.error("Signup error:", err);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthError(null);
    setAuthMessage(null);
    setAuthLoading(true);

    if (!email.trim() || !password.trim()) {
      setAuthError("Please enter email and password.");
      setAuthLoading(false);
      return;
    }

    try {
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        throw loginError;
      }

      const user = loginData.user;
      setCurrentUser(user ?? null);
      if (user?.id) {
        await loadProfile(user.id);
      } else {
        setCurrentProfile(null);
        setCurrentOrganizationId(null);
      }
      setAuthMessage("Logged in successfully.");
      setPassword("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to log in");
      console.error("Login error:", err);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setAuthError(null);
    setAuthMessage(null);
    setAuthLoading(true);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      setCurrentUser(null);
      setCurrentProfile(null);
      setCurrentOrganizationId(null);
      setAuthMessage("Logged out successfully.");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to log out");
      console.error("Logout error:", err);
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchBrands = async (organizationId?: string) => {
    setBrandsLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setBrands([]);
      setBrandsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("brands")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });

    setBrandsLoading(false);

    if (error) {
      console.error("Supabase fetch brands error:", error);
      return;
    }

    setBrands(data ?? []);
  };

  const clearCreditOverrideState = () => {
    setCreditWarning(null);
    setCreditOverrideConfirmation(null);
  };

  const handleAddSalesLine = () => {
    clearCreditOverrideState();
    setSalesLines([
      ...salesLines,
      { product_id: null, quantity: "", selling_price: "" },
    ]);
  };

  const handleRemoveSalesLine = (index: number) => {
    clearCreditOverrideState();
    setSalesLines(salesLines.filter((_, i) => i !== index));
  };

  const handleSalesLineChange = (
    index: number,
    field: keyof SalesLine,
    value: string | null
  ) => {
    clearCreditOverrideState();
    const newLines = [...salesLines];
    newLines[index] = { ...newLines[index], [field]: value } as SalesLine;
    // if product selected, populate default selling price
    if (field === "product_id" && value) {
      const prod = products.find((p) => String(p.id) === value);
      if (prod) {
        newLines[index].selling_price = prod.default_selling_price != null ? String(prod.default_selling_price) : "";
      }
    }
    setSalesLines(newLines);
  };

  const handleSalesCustomerChange = (customerId: string) => {
    setSelectedCustomerIdForSale(customerId === "" ? null : customerId);
    setSalesPaymentType("cash");
    clearCreditOverrideState();
  };

  const handleSalesPaymentTypeChange = (paymentType: "cash" | "credit") => {
    setSalesPaymentType(paymentType);
    clearCreditOverrideState();
  };

  const handleSalesInvoiceDateChange = (value: string) => {
    setSalesInvoiceDate(value);
    clearCreditOverrideState();
  };

  const handleCustomerPaymentCustomerChange = (customerId: string) => {
    setSelectedCustomerPaymentId(customerId === "" ? null : customerId);
    setCustomerPaymentAllocationsByInvoice({});
  };

  const handleCustomerPaymentAmountChange = (amount: string) => {
    setCustomerPaymentAmount(amount);
    setCustomerPaymentAllocationsByInvoice({});
  };

  const handleCustomerPaymentAllocationChange = (invoiceId: string, amount: string) => {
    setCustomerPaymentAllocationsByInvoice((current) => ({
      ...current,
      [invoiceId]: amount,
    }));
  };

  const handleAutoAllocateCustomerPayment = () => {
    const paymentAmount = Number(customerPaymentAmount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setCustomerPaymentError("Please enter a valid payment amount before auto allocating.");
      setCustomerPaymentMessage(null);
      return;
    }

    let remainingPaymentAmount = paymentAmount;
    const nextAllocations: Record<string, string> = {};

    unpaidCreditInvoicesForSelectedPaymentCustomer.forEach((invoice) => {
      if (remainingPaymentAmount <= 0) return;
      const allocationAmount = Math.min(remainingPaymentAmount, invoice.remainingUnpaidAmount);
      if (allocationAmount > 0) {
        nextAllocations[invoice.transaction.id] = String(allocationAmount);
        remainingPaymentAmount -= allocationAmount;
      }
    });

    setCustomerPaymentError(null);
    setCustomerPaymentAllocationsByInvoice(nextAllocations);
  };

  const handleCreateSalesInvoice = async (overrideConfirmed = false) => {
    if (salesInvoiceLoading) {
      return;
    }

    setCreditWarning(null);

    if (!selectedCustomerIdForSale) {
      setSalesError("Please select a customer");
      setSalesMessage(null);
      return;
    }

    if (!salesInvoiceNumber.trim()) {
      setSalesError("Invoice number is required");
      setSalesMessage(null);
      return;
    }

    if (salesLines.length === 0 || salesLines.some((line) => !line.product_id)) {
      setSalesError("Please add at least one product line");
      setSalesMessage(null);
      return;
    }

    if (!salesInvoiceDate || Number.isNaN(new Date(`${salesInvoiceDate}T00:00:00`).getTime())) {
      setSalesError("Please select a valid sale date");
      setSalesMessage(null);
      return;
    }

    let creditDueDate: string | null = null;
    let creditLimitSnapshot: number | null = null;
    let creditDaysSnapshot: number | null = null;

    if (salesPaymentType === "credit") {
      if (!selectedSalesCustomer) {
        setSalesError("Please select a valid customer");
        setSalesMessage(null);
        return;
      }

      if (selectedCustomerCreditPolicy === "cash_only") {
        const warning = "This customer is configured as Cash Only.";
        setCreditWarning(warning);
        setSalesError(warning);
        setSalesMessage(null);
        return;
      }

      const policyHasCreditLimit =
        selectedCustomerCreditPolicy === "limit_only" ||
        selectedCustomerCreditPolicy === "limit_and_days";
      const policyHasCreditDays =
        selectedCustomerCreditPolicy === "days_only" ||
        selectedCustomerCreditPolicy === "limit_and_days";
      const isOverCreditLimit =
        policyHasCreditLimit && projectedCustomerBalance > selectedCustomerCreditLimit;
      const hasOverdueCredit = policyHasCreditDays && selectedCustomerOverdueInvoiceCount > 0;

      if (isOverCreditLimit && !selectedCustomerAllowsOverLimit) {
        const warning = `Credit limit exceeded. Current balance: ${pkrFormatter.format(
          selectedCustomerOutstandingBalance
        )}. Invoice total: ${pkrFormatter.format(
          currentSalesInvoiceTotal
        )}. Projected balance: ${pkrFormatter.format(
          projectedCustomerBalance
        )}. Credit limit: ${pkrFormatter.format(selectedCustomerCreditLimit)}.`;
        setCreditWarning(warning);
        setSalesError(warning);
        setSalesMessage(null);
        return;
      }

      if (hasOverdueCredit && !selectedCustomerAllowsOverdueSales) {
        const warning = `Customer has overdue credit. Overdue invoices: ${selectedCustomerOverdueInvoiceCount}. Overdue amount: ${pkrFormatter.format(
          selectedCustomerTotalOverdueAmount
        )}. Oldest overdue due date: ${selectedCustomerOldestOverdueDueDate ?? "Unknown"}.`;
        setCreditWarning(warning);
        setSalesError(warning);
        setSalesMessage(null);
        return;
      }

      const needsOverLimitOverride = isOverCreditLimit && selectedCustomerAllowsOverLimit;
      const needsOverdueOverride = hasOverdueCredit && selectedCustomerAllowsOverdueSales;
      if ((needsOverLimitOverride || needsOverdueOverride) && !overrideConfirmed) {
        setCreditOverrideConfirmation({
          overLimit: needsOverLimitOverride,
          overdue: needsOverdueOverride,
        });
        setCreditWarning(null);
        setSalesError(null);
        setSalesMessage(null);
        return;
      }

      if (
        selectedCustomerCreditPolicy === "days_only" ||
        selectedCustomerCreditPolicy === "limit_and_days" ||
        selectedCustomerHasUsableUnrestrictedCreditDays
      ) {
        const validCreditDays =
          Number.isFinite(selectedCustomerCreditDays) &&
          Number.isInteger(selectedCustomerCreditDays) &&
          selectedCustomerCreditDays >= 0;
        if (!validCreditDays) {
          setSalesError("Customer credit days are invalid.");
          setSalesMessage(null);
          return;
        }

        creditDueDate = addDaysToDateInputValue(salesInvoiceDate, selectedCustomerCreditDays);
        if (!creditDueDate) {
          setSalesError("Could not calculate a valid credit due date.");
          setSalesMessage(null);
          return;
        }
        creditDaysSnapshot = selectedCustomerCreditDays;
      }

      if (
        selectedCustomerCreditPolicy === "limit_only" ||
        selectedCustomerCreditPolicy === "limit_and_days"
      ) {
        if (!Number.isFinite(selectedCustomerCreditLimit) || selectedCustomerCreditLimit < 0) {
          setSalesError("Customer credit limit is invalid.");
          setSalesMessage(null);
          return;
        }
        creditLimitSnapshot = selectedCustomerCreditLimit;
      }
    }

    setSalesError(null);
    setSalesMessage(null);
    setSalesInvoiceLoading(true);

    try {
      if (!currentOrganizationId) {
        setSalesError("Organization not loaded. Please login again.");
        setSalesInvoiceLoading(false);
        return;
      }

      const tx = await supabase
        .from("sales_transactions")
        .insert({
          customer_id: selectedCustomerIdForSale,
          invoice_number: salesInvoiceNumber,
          sale_date: salesInvoiceDate,
          payment_type: salesPaymentType,
          credit_due_date: salesPaymentType === "credit" ? creditDueDate : null,
          credit_limit_snapshot: salesPaymentType === "credit" ? creditLimitSnapshot : null,
          credit_days_snapshot: salesPaymentType === "credit" ? creditDaysSnapshot : null,
          notes: null,
          organization_id: currentOrganizationId,
        })
        .select()
        .single();

      console.log("sales transaction result", tx);

      if (tx.error) {
        console.error("sales_transactions error", JSON.stringify(tx.error, null, 2));
        throw tx.error;
      }

      const salesTransactionId = tx.data?.id;
      if (!salesTransactionId) throw new Error("Failed to create sales transaction");

      for (const line of salesLines) {
        if (!line.product_id) continue;
        const latestPurchaseItem = purchaseItems
          .filter(
            (item) =>
              String(item.product_id) === String(line.product_id) &&
              Number.isFinite(Number(item.purchase_price)) &&
              Number(item.purchase_price) > 0
          )
          .sort((a, b) => {
            const aTransaction = purchaseTransactions.find(
              (tx) => tx.id === a.purchase_transaction_id
            );
            const bTransaction = purchaseTransactions.find(
              (tx) => tx.id === b.purchase_transaction_id
            );
            const aTime = aTransaction?.created_at
              ? new Date(aTransaction.created_at).getTime()
              : 0;
            const bTime = bTransaction?.created_at
              ? new Date(bTransaction.created_at).getTime()
              : 0;
            return bTime - aTime;
          })[0];
        const product = products.find((p) => String(p.id) === String(line.product_id));
        const latestPurchasePrice = Number(latestPurchaseItem?.purchase_price);
        const productLastPurchasePrice = Number(product?.last_purchase_price);
        const purchasePriceSnapshot =
          Number.isFinite(latestPurchasePrice) && latestPurchasePrice > 0
            ? latestPurchasePrice
            : Number.isFinite(productLastPurchasePrice) && productLastPurchasePrice > 0
              ? productLastPurchasePrice
              : null;

        const { error: itemError } = await supabase.from("sales_items").insert({
          sales_transaction_id: salesTransactionId,
          product_id: line.product_id,
          quantity: Number(line.quantity),
          selling_price: Number(line.selling_price),
          purchase_price_snapshot: purchasePriceSnapshot,
        });

        if (itemError) throw itemError;
      }

      setSalesMessage("Sales invoice saved successfully");
      setSelectedCustomerIdForSale(null);
      setSalesInvoiceNumber("");
      setSalesInvoiceDate(toDateInputValue(new Date()));
      setSalesPaymentType("cash");
      clearCreditOverrideState();
      setSalesLines([]);

      // Refresh dashboard and history
      fetchSalesTransactions();
      fetchSalesItems();
      fetchPurchaseItems();
      fetchProducts();
    } catch (err) {
      setSalesError(err instanceof Error ? err.message : "Failed to save sales invoice");
      console.error("Error creating sales invoice:", err);
    } finally {
      setSalesInvoiceLoading(false);
    }
  };

  const handleSaveCustomerPayment = async () => {
    if (!selectedCustomerPaymentId) {
      setCustomerPaymentError("Please select a customer");
      setCustomerPaymentMessage(null);
      return;
    }
    const paymentAmount = Number(customerPaymentAmount);
    if (!customerPaymentAmount || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setCustomerPaymentError("Please enter a valid amount");
      setCustomerPaymentMessage(null);
      return;
    }
    const allocationRows = unpaidCreditInvoicesForSelectedPaymentCustomer
      .map((invoice) => {
        const allocationAmount = Number(customerPaymentAllocationsByInvoice[invoice.transaction.id] || 0);
        return {
          invoice,
          allocationAmount,
        };
      })
      .filter(({ allocationAmount }) => allocationAmount !== 0);
    const invalidNegativeAllocation = allocationRows.some(
      ({ allocationAmount }) => !Number.isFinite(allocationAmount) || allocationAmount < 0
    );
    if (invalidNegativeAllocation) {
      setCustomerPaymentError("Allocation amounts must be zero or greater.");
      setCustomerPaymentMessage(null);
      return;
    }
    const allocationExceedsInvoice = allocationRows.some(
      ({ invoice, allocationAmount }) => allocationAmount > invoice.remainingUnpaidAmount
    );
    if (allocationExceedsInvoice) {
      setCustomerPaymentError("Allocation cannot exceed an invoice remaining balance.");
      setCustomerPaymentMessage(null);
      return;
    }
    const totalAllocationAmount = allocationRows.reduce(
      (sum, row) => sum + row.allocationAmount,
      0
    );
    if (totalAllocationAmount > paymentAmount) {
      setCustomerPaymentError("Total allocations cannot exceed the payment amount.");
      setCustomerPaymentMessage(null);
      return;
    }

    setCustomerPaymentError(null);
    setCustomerPaymentMessage(null);
    setCustomerPaymentLoading(true);

    try {
      if (!currentOrganizationId) {
        setCustomerPaymentError("Organization not loaded. Please login again.");
        setCustomerPaymentLoading(false);
        return;
      }

      const { data: paymentData, error } = await supabase
        .from("customer_payments")
        .insert({
        customer_id: selectedCustomerPaymentId,
          amount: paymentAmount,
        notes: customerPaymentNotes || null,
        organization_id: currentOrganizationId,
        })
        .select("id")
        .single();

      if (error) throw error;

      const insertedPaymentId = paymentData?.id;
      if (!insertedPaymentId) {
        throw new Error("Payment saved but no payment id was returned.");
      }

      const allocationsToInsert = allocationRows
        .filter((row) => row.allocationAmount > 0)
        .map((row) => ({
          organization_id: currentOrganizationId,
          customer_payment_id: insertedPaymentId,
          sales_transaction_id: row.invoice.transaction.id,
          amount: row.allocationAmount,
        }));

      if (allocationsToInsert.length > 0) {
        const { error: allocationError } = await supabase
          .from("customer_payment_allocations")
          .insert(allocationsToInsert);

        if (allocationError) {
          console.error(
            "Supabase customer payment allocation insert error:",
            JSON.stringify(allocationError, null, 2)
          );
          setCustomerPaymentMessage(null);
          setCustomerPaymentError(
            "Payment saved, but one or more invoice allocations could not be saved."
          );
          await fetchCustomerPayments(currentOrganizationId);
          await fetchCustomerPaymentAllocations(currentOrganizationId);
          setCustomerPaymentLoading(false);
          return;
        }
      }

      setCustomerPaymentMessage("Payment saved successfully");
      setSelectedCustomerPaymentId(null);
      setCustomerPaymentAmount("");
      setCustomerPaymentNotes("");
      setCustomerPaymentAllocationsByInvoice({});
      await fetchCustomerPayments(currentOrganizationId);
      await fetchCustomerPaymentAllocations(currentOrganizationId);
    } catch (err) {
      setCustomerPaymentError(err instanceof Error ? err.message : "Failed to save payment");
      console.error("Error saving customer payment:", err);
    } finally {
      setCustomerPaymentLoading(false);
    }
  };

  const handleSaveSupplierPayment = async () => {
    if (!selectedSupplierPaymentId) {
      setSupplierPaymentError("Please select a supplier");
      setSupplierPaymentMessage(null);
      return;
    }
    if (!supplierPaymentAmount || Number(supplierPaymentAmount) <= 0) {
      setSupplierPaymentError("Please enter a valid amount");
      setSupplierPaymentMessage(null);
      return;
    }

    setSupplierPaymentError(null);
    setSupplierPaymentMessage(null);
    setSupplierPaymentLoading(true);

    try {
      if (!currentOrganizationId) {
        setSupplierPaymentError("Organization not loaded. Please login again.");
        setSupplierPaymentLoading(false);
        return;
      }

      const { error } = await supabase.from("supplier_payments").insert({
        supplier_id: selectedSupplierPaymentId,
        amount: Number(supplierPaymentAmount),
        notes: supplierPaymentNotes || null,
        organization_id: currentOrganizationId,
      });

      if (error) throw error;

      setSupplierPaymentMessage("Payment saved successfully");
      setSelectedSupplierPaymentId(null);
      setSupplierPaymentAmount("");
      setSupplierPaymentNotes("");
      // refresh
      fetchSupplierPayments();
    } catch (err) {
      setSupplierPaymentError(err instanceof Error ? err.message : "Failed to save payment");
      console.error("Error saving supplier payment:", err);
    } finally {
      setSupplierPaymentLoading(false);
    }
  };

  const saveExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (expenseLoading) {
      return;
    }

    if (!currentOrganizationId) {
      setExpenseMessage("Error: Organization not loaded. Please login again.");
      return;
    }

    if (!expenseType) {
      setExpenseMessage("Error: Please select an expense type.");
      return;
    }

    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setExpenseMessage("Error: Please enter an amount greater than zero.");
      return;
    }

    setExpenseLoading(true);
    setExpenseMessage(null);

    const { error } = await supabase.from("expenses").insert({
      organization_id: currentOrganizationId,
      expense_type: expenseType,
      amount,
      notes: expenseNotes.trim() || null,
      supplier_id: selectedExpenseSupplierId || null,
      customer_id: selectedExpenseCustomerId || null,
      purchase_transaction_id: selectedExpensePurchaseId || null,
      sales_transaction_id: selectedExpenseSaleId || null,
    });

    if (error) {
      setExpenseMessage(`Error saving expense: ${JSON.stringify(error, null, 2)}`);
      setExpenseLoading(false);
      return;
    }

    let statusUpdateWarning: string | null = null;

    if (selectedExpensePurchaseId) {
      const { error: statusUpdateError } = await supabase
        .from("purchase_transactions")
        .update({
          expense_review_status: "expenses_added",
          expense_reviewed_at: new Date().toISOString(),
        })
        .eq("id", selectedExpensePurchaseId)
        .eq("organization_id", currentOrganizationId);

      if (statusUpdateError) {
        statusUpdateWarning = "Expense saved, but purchase expense status could not be updated.";
        console.error(
          "Purchase expense status update error:",
          JSON.stringify(statusUpdateError, null, 2)
        );
      }
    }

    await fetchExpenses(currentOrganizationId);
    if (selectedExpensePurchaseId && !statusUpdateWarning) {
      await fetchPurchaseTransactions(currentOrganizationId);
    }

    setExpenseMessage(statusUpdateWarning ?? "Expense saved successfully.");
    setExpenseType("");
    setExpenseAmount("");
    setExpenseNotes("");
    setSelectedExpenseSupplierId("");
    setSelectedExpenseCustomerId("");
    setSelectedExpensePurchaseId("");
    setSelectedExpenseSaleId("");
    setExpenseLoading(false);
  };

  const handleAddPurchaseExpense = (purchaseId: string, supplierId: string) => {
    setSelectedExpensePurchaseId(purchaseId);
    setSelectedExpenseSupplierId(supplierId);
    setSelectedExpenseCustomerId("");
    setSelectedExpenseSaleId("");
    document.getElementById("expense-management")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const updatePurchaseExpenseStatus = async (
    purchaseId: string,
    status: "no_additional_expense" | "review_later"
  ) => {
    setPurchaseExpenseStatusMessage(null);

    if (!currentOrganizationId) {
      setPurchaseExpenseStatusMessage("Organization not loaded. Please login again.");
      return;
    }

    const updateData =
      status === "no_additional_expense"
        ? {
            expense_review_status: "no_additional_expense",
            expense_reviewed_at: new Date().toISOString(),
          }
        : {
            expense_review_status: "review_later",
            expense_reviewed_at: null,
          };

    const { error } = await supabase
      .from("purchase_transactions")
      .update(updateData)
      .eq("id", purchaseId)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      setPurchaseExpenseStatusMessage(`Failed to update expense review: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await fetchPurchaseTransactions(currentOrganizationId);
    setNewPurchaseExpenseReminder(null);
    setPurchaseExpenseStatusMessage(
      status === "no_additional_expense"
        ? "Purchase marked as having no additional expense."
        : "Purchase marked for expense review later."
    );
  };

  const fetchCategories = async (organizationId?: string) => {
    setCategoriesLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setCategories([]);
      setCategoriesLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("categories")
      .select("id, name, parent_category_id")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });

    setCategoriesLoading(false);

    if (error) {
      console.error("Supabase fetch categories error:", error);
      return;
    }

    setCategories(data ?? []);
  };

  const fetchProducts = async (organizationId?: string) => {
    setProductsLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setProducts([]);
      setProductsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("products")
      .select("id, name, brand_id, category_id, unit_type, last_purchase_price, default_selling_price, reorder_level, track_batch, track_expiry")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });

    setProductsLoading(false);

    if (error) {
      console.error("Supabase fetch products error:", error);
      return;
    }

    setProducts(data ?? []);
  };

  const fetchCustomers = async (organizationId?: string) => {
    setCustomersLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setCustomers([]);
      setCustomersLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("customers")
      .select(
        "id, customer_name, shop_name, phone, whatsapp, city, area, customer_type, credit_policy, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, preferred_payment_method"
      )
      .eq("organization_id", orgId)
      .order("customer_name", { ascending: true });

    setCustomersLoading(false);

    if (error) {
      console.error("Supabase fetch customers error:", error);
      return;
    }

    setCustomers(data ?? []);
  };

  const fetchSuppliers = async (organizationId?: string) => {
    setSuppliersLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setSuppliers([]);
      setSuppliersLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("suppliers")
      .select("id, supplier_name, contact_person, phone, whatsapp, city, notes")
      .eq("organization_id", orgId)
      .order("supplier_name", { ascending: true });

    setSuppliersLoading(false);

    if (error) {
      console.error("Supabase fetch suppliers error:", error);
      return;
    }

    setSuppliers(data ?? []);
  };

  const fetchPurchaseTransactions = async (organizationId?: string) => {
    setPurchaseLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setPurchaseTransactions([]);
      setPurchaseLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("purchase_transactions")
      .select("id, supplier_id, invoice_number, created_at, expense_review_status, expense_reviewed_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    setPurchaseLoading(false);

    if (error) {
      console.error("Supabase fetch purchase transactions error:", error);
      return;
    }

    setPurchaseTransactions(data ?? []);
  };

  // Purchase & Sales items + Sales transactions (for dashboard & history)
  const [purchaseItems, setPurchaseItems] = useState<any[]>([]);
  const [salesItems, setSalesItems] = useState<any[]>([]);

  const [salesTransactions, setSalesTransactions] = useState<SalesTransaction[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);

  // Payments
  const [customerPayments, setCustomerPayments] = useState<any[]>([]);
  const [customerPaymentAllocations, setCustomerPaymentAllocations] = useState<any[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [expenseType, setExpenseType] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [selectedExpenseSupplierId, setSelectedExpenseSupplierId] = useState("");
  const [selectedExpenseCustomerId, setSelectedExpenseCustomerId] = useState("");
  const [selectedExpensePurchaseId, setSelectedExpensePurchaseId] = useState("");
  const [selectedExpenseSaleId, setSelectedExpenseSaleId] = useState("");
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseMessage, setExpenseMessage] = useState<string | null>(null);

  const [selectedCustomerPaymentId, setSelectedCustomerPaymentId] = useState<string | null>(null);
  const [customerPaymentAmount, setCustomerPaymentAmount] = useState("");
  const [customerPaymentNotes, setCustomerPaymentNotes] = useState("");
  const [customerPaymentLoading, setCustomerPaymentLoading] = useState(false);
  const [customerPaymentMessage, setCustomerPaymentMessage] = useState<string | null>(null);
  const [customerPaymentError, setCustomerPaymentError] = useState<string | null>(null);
  const [customerPaymentAllocationsByInvoice, setCustomerPaymentAllocationsByInvoice] =
    useState<Record<string, string>>({});

  const [selectedSupplierPaymentId, setSelectedSupplierPaymentId] = useState<string | null>(null);
  const [supplierPaymentAmount, setSupplierPaymentAmount] = useState("");
  const [supplierPaymentNotes, setSupplierPaymentNotes] = useState("");
  const [supplierPaymentLoading, setSupplierPaymentLoading] = useState(false);
  const [supplierPaymentMessage, setSupplierPaymentMessage] = useState<string | null>(null);
  const [supplierPaymentError, setSupplierPaymentError] = useState<string | null>(null);

  const [selectedCustomerIdForSale, setSelectedCustomerIdForSale] = useState<string | null>(null);
  const [salesInvoiceNumber, setSalesInvoiceNumber] = useState("");
  const [salesInvoiceDate, setSalesInvoiceDate] = useState(toDateInputValue(new Date()));
  const [salesPaymentType, setSalesPaymentType] = useState<"cash" | "credit">("cash");
  const [creditWarning, setCreditWarning] = useState<string | null>(null);
  const [creditOverrideConfirmation, setCreditOverrideConfirmation] = useState<{
    overLimit: boolean;
    overdue: boolean;
  } | null>(null);
  interface SalesLine { product_id: string | null; quantity: string; selling_price: string; }
  const [salesLines, setSalesLines] = useState<SalesLine[]>([]);
  const [salesMessage, setSalesMessage] = useState<string | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [salesInvoiceLoading, setSalesInvoiceLoading] = useState(false);
  const currentMonthRange = getMonthRange();
  const [profitLossStartDate, setProfitLossStartDate] = useState(currentMonthRange.start);
  const [profitLossEndDate, setProfitLossEndDate] = useState(currentMonthRange.end);
  const [profitLossDateError, setProfitLossDateError] = useState<string | null>(null);
  const expenseTypes = [
    "Purchase Transport",
    "Sales Delivery",
    "Fuel",
    "Vehicle Rent",
    "Loading/Unloading",
    "Salary",
    "Electricity",
    "Shop/Warehouse Rent",
    "Food/Travel",
    "Maintenance",
    "Other",
  ];
  const pkrFormatter = new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2,
  });
  const creditPolicyLabels: Record<string, string> = {
    cash_only: "Cash Only",
    limit_only: "Credit Limit Only",
    days_only: "Credit Days Only",
    limit_and_days: "Credit Limit and Days",
    unrestricted: "Unrestricted Credit",
  };
  const policyUsesCreditLimit = (policy: string) =>
    policy === "limit_only" || policy === "limit_and_days";
  const policyUsesCreditDays = (policy: string) =>
    policy === "days_only" || policy === "limit_and_days";
  const handleCreditPolicyChange = (policy: string) => {
    setCreditPolicy(policy);

    if (!policyUsesCreditLimit(policy)) {
      setCreditLimit("");
      setAllowOverLimit(false);
    }

    if (!policyUsesCreditDays(policy)) {
      setCreditDays("");
      setAllowOverdueSales(false);
    }
  };

  const fetchPurchaseItems = async () => {
    const { data, error } = await supabase
      .from("purchase_items")
      .select("id, purchase_transaction_id, product_id, quantity, purchase_price, selling_price, batch_number, expiry_date")
      .order("id", { ascending: true });

    if (error) {
      console.error("Supabase fetch purchase items error:", error);
      return;
    }

    setPurchaseItems(data ?? []);
  };

  const fetchCustomerPayments = async (organizationId?: string) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setCustomerPayments([]);
      return;
    }

    const { data, error } = await supabase
      .from("customer_payments")
      .select("id, customer_id, amount, notes, created_at")
      .eq("organization_id", orgId)
      .order("id", { ascending: true });

    if (error) {
      console.error("Supabase fetch customer payments error:", error);
      return;
    }

    setCustomerPayments(data ?? []);
  };

  const fetchCustomerPaymentAllocations = async (organizationId?: string) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setCustomerPaymentAllocations([]);
      return;
    }

    const { data, error } = await supabase
      .from("customer_payment_allocations")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Supabase fetch customer payment allocations error:", JSON.stringify(error, null, 2));
      return;
    }

    setCustomerPaymentAllocations(data ?? []);
  };

  const fetchSupplierPayments = async (organizationId?: string) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setSupplierPayments([]);
      return;
    }

    const { data, error } = await supabase
      .from("supplier_payments")
      .select("id, supplier_id, amount, notes")
      .eq("organization_id", orgId)
      .order("id", { ascending: true });

    if (error) {
      console.error("Supabase fetch supplier payments error:", error);
      return;
    }

    setSupplierPayments(data ?? []);
  };

  const fetchSalesItems = async () => {
    const { data, error } = await supabase
      .from("sales_items")
      .select("id, sales_transaction_id, product_id, quantity, selling_price, purchase_price_snapshot")
      .order("id", { ascending: true });

    if (error) {
      console.error("Supabase fetch sales items error:", error);
      return;
    }

    setSalesItems(data ?? []);
  };

  const fetchSalesTransactions = async (organizationId?: string) => {
    setSalesLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setSalesTransactions([]);
      setSalesLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("sales_transactions")
      .select("id, customer_id, invoice_number, created_at, sale_date, payment_type, credit_due_date, credit_limit_snapshot, credit_days_snapshot")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    setSalesLoading(false);

    if (error) {
      console.error("Supabase fetch sales transactions error:", error);
      return;
    }

    setSalesTransactions(data ?? []);
  };

  const handleAddBrand = async () => {
    if (!brandName.trim()) {
      setBrandError("Brand name is required");
      setBrandMessage(null);
      return;
    }

    if (!currentOrganizationId) {
      setBrandError("Organization not loaded. Please login again.");
      setBrandMessage(null);
      return;
    }

    setBrandError(null);
    setBrandMessage(null);
    setBrandsLoading(true);

    const { error } = await supabase.from("brands").insert({
      name: brandName,
      organization_id: currentOrganizationId,
    });

    setBrandsLoading(false);

    if (error) {
      setBrandError("Failed to add brand");
      console.error("Supabase add brand error:", error);
      return;
    }

    setBrandMessage("Brand added successfully");
    setBrandName("");
    fetchBrands();
  };

  const handleDeleteBrand = async (brandId: string) => {
    setBrandError(null);
    setBrandMessage(null);
    setBrandsLoading(true);

    const { error } = await supabase.from("brands").delete().eq("id", brandId);

    setBrandsLoading(false);

    if (error) {
      setBrandError("Failed to delete brand");
      console.error("Supabase delete brand error:", error);
      return;
    }

    setBrandMessage("Brand deleted successfully");
    fetchBrands();
  };

  const handleAddCategory = async () => {
    if (!categoryName.trim()) {
      setCategoryError("Category name is required");
      setCategoryMessage(null);
      return;
    }

    if (!currentOrganizationId) {
      setCategoryError("Organization not loaded. Please login again.");
      setCategoryMessage(null);
      return;
    }

    setCategoryError(null);
    setCategoryMessage(null);
    setCategoriesLoading(true);

    const { error } = await supabase.from("categories").insert({
      name: categoryName,
      parent_category_id: parentCategoryId,
      organization_id: currentOrganizationId,
    });

    setCategoriesLoading(false);

    if (error) {
      setCategoryError("Failed to add category");
      console.error("Supabase add category error:", error);
      return;
    }

    setCategoryMessage("Category added successfully");
    setCategoryName("");
    setParentCategoryId(null);
    fetchCategories();
  };

  const handleDeleteCategory = async (categoryId: string) => {
    setCategoryError(null);
    setCategoryMessage(null);
    setCategoriesLoading(true);

    const { error } = await supabase.from("categories").delete().eq("id", categoryId);

    setCategoriesLoading(false);

    if (error) {
      setCategoryError("Failed to delete category");
      console.error("Supabase delete category error:", error);
      return;
    }

    setCategoryMessage("Category deleted successfully");
    fetchCategories();
  };

  const handleDeleteProduct = async (productId: number) => {
    setMessage(null);
    setError(null);
    setProductsLoading(true);

    const { error } = await supabase.from("products").delete().eq("id", productId);

    setProductsLoading(false);

    if (error) {
      setError("Failed to delete product");
      console.error("Supabase delete product error:", error);
      return;
    }

    setMessage("Product deleted successfully");
    fetchProducts();
  };

  const handleAddCustomer = async () => {
    if (!customerName.trim()) {
      setCustomerError("Customer name is required");
      setCustomerMessage(null);
      return;
    }

    if (!currentOrganizationId) {
      setCustomerError("Organization not loaded. Please login again.");
      setCustomerMessage(null);
      return;
    }

    const requiresCreditLimit = policyUsesCreditLimit(creditPolicy);
    const requiresCreditDays = policyUsesCreditDays(creditPolicy);
    const parsedCreditLimit = requiresCreditLimit ? Number(creditLimit) : 0;
    const parsedCreditDays = requiresCreditDays ? Number(creditDays) : 0;

    if (
      requiresCreditLimit &&
      (!creditLimit.trim() || !Number.isFinite(parsedCreditLimit) || parsedCreditLimit < 0)
    ) {
      setCustomerError("Credit limit must be a valid amount greater than or equal to zero.");
      setCustomerMessage(null);
      return;
    }

    if (
      requiresCreditDays &&
      (!creditDays.trim() ||
        !Number.isFinite(parsedCreditDays) ||
        !Number.isInteger(parsedCreditDays) ||
        parsedCreditDays < 0)
    ) {
      setCustomerError("Credit days must be a whole number greater than or equal to zero.");
      setCustomerMessage(null);
      return;
    }

    setCustomerError(null);
    setCustomerMessage(null);
    setCustomersLoading(true);

    const { error } = await supabase.from("customers").insert({
      customer_name: customerName,
      shop_name: shopName || null,
      phone: phone || null,
      whatsapp: whatsapp || null,
      city: city || null,
      area: area || null,
      customer_type: customerType,
      credit_policy: creditPolicy,
      credit_limit: requiresCreditLimit ? parsedCreditLimit : 0,
      credit_days: requiresCreditDays ? parsedCreditDays : 0,
      allow_over_limit: requiresCreditLimit ? allowOverLimit : false,
      allow_overdue_sales: requiresCreditDays ? allowOverdueSales : false,
      organization_id: currentOrganizationId,
    });

    setCustomersLoading(false);

    if (error) {
      setCustomerError("Failed to save customer");
      console.error("Supabase add customer error:", error);
      return;
    }

    setCustomerMessage("Customer saved successfully");
    setCustomerName("");
    setShopName("");
    setPhone("");
    setWhatsapp("");
    setCity("");
    setArea("");
    setCustomerType("Retailer");
    setCreditPolicy("cash_only");
    setCreditLimit("");
    setCreditDays("");
    setAllowOverLimit(false);
    setAllowOverdueSales(false);
    fetchCustomers();
  };

  const handleDeleteCustomer = async (customerId: string) => {
    setCustomerError(null);
    setCustomerMessage(null);
    setCustomersLoading(true);

    const { error } = await supabase.from("customers").delete().eq("id", customerId);

    setCustomersLoading(false);

    if (error) {
      setCustomerError("Failed to delete customer");
      console.error("Supabase delete customer error:", error);
      return;
    }

    setCustomerMessage("Customer deleted successfully");
    fetchCustomers();
  };

  const handleAddSupplier = async () => {
    if (!supplierName.trim()) {
      setSupplierError("Supplier name is required");
      setSupplierMessage(null);
      return;
    }

    if (!currentOrganizationId) {
      setSupplierError("Organization not loaded. Please login again.");
      setSupplierMessage(null);
      return;
    }

    setSupplierError(null);
    setSupplierMessage(null);
    setSuppliersLoading(true);

    const { error } = await supabase.from("suppliers").insert({
      supplier_name: supplierName,
      contact_person: contactPerson || null,
      phone: supplierPhone || null,
      whatsapp: supplierWhatsapp || null,
      city: supplierCity || null,
      notes: supplierNotes || null,
      organization_id: currentOrganizationId,
    });

    setSuppliersLoading(false);

    if (error) {
      setSupplierError("Failed to save supplier");
      console.error("Supabase add supplier error:", error);
      return;
    }

    setSupplierMessage("Supplier saved successfully");
    setSupplierName("");
    setContactPerson("");
    setSupplierPhone("");
    setSupplierWhatsapp("");
    setSupplierCity("");
    setSupplierNotes("");
    fetchSuppliers();
  };

  const handleDeleteSupplier = async (supplierId: string) => {
    setSupplierError(null);
    setSupplierMessage(null);
    setSuppliersLoading(true);

    const { error } = await supabase.from("suppliers").delete().eq("id", supplierId);

    setSuppliersLoading(false);

    if (error) {
      setSupplierError("Failed to delete supplier");
      console.error("Supabase delete supplier error:", error);
      return;
    }

    setSupplierMessage("Supplier deleted successfully");
    fetchSuppliers();
  };

  const filteredSuppliers = suppliers.filter((supplier) => {
    const searchTerm = supplierSearch.trim().toLowerCase();
    if (!searchTerm) return true;
    return [supplier.supplier_name, supplier.contact_person, supplier.phone].some(
      (value) => value?.toLowerCase().includes(searchTerm)
    );
  });

  const handleAddPurchaseLine = () => {
    setPurchaseLines([
      ...purchaseLines,
      {
        product_id: null,
        quantity: "",
        purchase_price: "",
        selling_price: "",
        batch_number: "",
        expiry_date: "",
      },
    ]);
  };

  const handleRemovePurchaseLine = (index: number) => {
    setPurchaseLines(purchaseLines.filter((_, i) => i !== index));
  };

  const handlePurchaseLineChange = (
    index: number,
    field: keyof PurchaseLine,
    value: string | null
  ) => {
    const newLines = [...purchaseLines];
    newLines[index] = { ...newLines[index], [field]: value };
    setPurchaseLines(newLines);
  };

  const handleCreatePurchaseInvoice = async () => {
    if (!selectedSupplierId) {
      setInvoiceError("Please select a supplier");
      setInvoiceMessage(null);
      return;
    }

    if (!invoiceNumber.trim()) {
      setInvoiceError("Invoice number is required");
      setInvoiceMessage(null);
      return;
    }

    if (purchaseLines.length === 0 || purchaseLines.some((line) => !line.product_id)) {
      setInvoiceError("Please add at least one product line");
      setInvoiceMessage(null);
      return;
    }

    setInvoiceError(null);
    setInvoiceMessage(null);
    setInvoiceLoading(true);

    try {
      console.log("Purchase Invoice Debug", {
        selectedSupplierId,
        invoiceNumber,
        purchaseLines,
      });

      if (!currentOrganizationId) {
        setInvoiceError("Organization not loaded. Please login again.");
        setInvoiceLoading(false);
        return;
      }

      const transactionResult = await supabase
        .from("purchase_transactions")
        .insert({
          supplier_id: selectedSupplierId,
          invoice_number: invoiceNumber,
          notes: null,
          organization_id: currentOrganizationId,
        })
        .select()
        .single();

      console.log("transactionResult", transactionResult);

      if (transactionResult.error) {
        console.error(
          "purchase_transactions error",
          JSON.stringify(transactionResult.error, null, 2)
        );
        throw transactionResult.error;
      }

      const transactionId = transactionResult.data?.id;
      if (!transactionId) throw new Error("Failed to create purchase transaction");

      // Create purchase items and update product selling prices
      for (const line of purchaseLines) {
        if (!line.product_id) continue;

        // Insert purchase item
        const { error: itemError } = await supabase.from("purchase_items").insert({
          purchase_transaction_id: transactionId,
          product_id: line.product_id,
          quantity: Number(line.quantity),
          purchase_price: Number(line.purchase_price),
          selling_price: line.selling_price ? Number(line.selling_price) : null,
          batch_number: line.batch_number || null,
          expiry_date: line.expiry_date || null,
        });

        if (itemError) throw itemError;

        // Update product default_selling_price
        if (line.selling_price) {
          console.log("Updating product selling price", {
            productId: line.product_id,
            sellingPrice: line.selling_price,
          });

          const { error: updateError } = await supabase
            .from("products")
            .update({ default_selling_price: Number(line.selling_price) })
            .eq("id", line.product_id);

          if (updateError) {
            console.error("Product update error:", updateError);
          }
        }
      }

      setInvoiceMessage("Purchase invoice created successfully");
      setNewPurchaseExpenseReminder({
        id: transactionId,
        invoiceNumber,
        supplierId: selectedSupplierId,
      });
      setPurchaseExpenseStatusMessage(null);
      setSelectedSupplierId(null);
      setInvoiceNumber("");
      setPurchaseLines([]);
      fetchPurchaseTransactions();
      fetchPurchaseItems();
      fetchProducts();
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : "Failed to create purchase invoice");
      console.error("Error creating purchase invoice:", err);
    } finally {
      setInvoiceLoading(false);
    }
  };

  const filteredCustomers = customers.filter((customer) => {
    const searchTerm = customerSearch.trim().toLowerCase();
    if (!searchTerm) return true;
    return [customer.customer_name, customer.shop_name, customer.phone].some(
      (value) => value?.toLowerCase().includes(searchTerm)
    );
  });
  const selectedSalesCustomer = customers.find((customer) => customer.id === selectedCustomerIdForSale);
  const selectedCustomerCreditPolicy = selectedSalesCustomer?.credit_policy ?? "cash_only";
  const selectedCustomerCreditLimit = Number(selectedSalesCustomer?.credit_limit || 0);
  const selectedCustomerCreditDays = Number(selectedSalesCustomer?.credit_days || 0);
  const selectedCustomerAllowsOverLimit = Boolean(selectedSalesCustomer?.allow_over_limit);
  const selectedCustomerAllowsOverdueSales = Boolean(selectedSalesCustomer?.allow_overdue_sales);
  const selectedCustomerHasUsableUnrestrictedCreditDays =
    selectedCustomerCreditPolicy === "unrestricted" &&
    Number.isFinite(selectedCustomerCreditDays) &&
    Number.isInteger(selectedCustomerCreditDays) &&
    selectedCustomerCreditDays > 0;
  const selectedCustomerCreditTransactionIds = salesTransactions
    .filter(
      (transaction) =>
        transaction.customer_id === selectedCustomerIdForSale &&
        transaction.payment_type === "credit"
    )
    .map((transaction) => transaction.id);
  const salesInvoiceTotalsByTransaction = salesTransactions.reduce<Record<string, number>>(
    (totals, transaction) => {
      totals[transaction.id] = salesItems
        .filter((item) => item.sales_transaction_id === transaction.id)
        .reduce(
          (sum, item) => sum + safeNumber(item.quantity) * safeNumber(item.selling_price),
          0
        );
      return totals;
    },
    {}
  );
  const explicitAllocatedAmountsBySalesTransaction = customerPaymentAllocations.reduce<Record<string, number>>(
    (totals, allocation) => {
      const salesTransactionId = String(allocation.sales_transaction_id ?? "");
      if (!salesTransactionId) return totals;
      totals[salesTransactionId] =
        (totals[salesTransactionId] ?? 0) + safeNumber(allocation.amount);
      return totals;
    },
    {}
  );
  const creditSalesTransactions = salesTransactions.filter(
    (transaction) => transaction.payment_type === "credit"
  );
  const salesTransactionsById = salesTransactions.reduce<Record<string, SalesTransaction>>(
    (transactions, transaction) => {
      transactions[transaction.id] = transaction;
      return transactions;
    },
    {}
  );
  const totalCustomerPaymentsByCustomer = customerPayments.reduce<Record<string, number>>(
    (totals, payment) => {
      const customerId = String(payment.customer_id ?? "");
      if (!customerId) return totals;
      totals[customerId] = (totals[customerId] ?? 0) + safeNumber(payment.amount);
      return totals;
    },
    {}
  );
  const explicitAllocatedPaymentsByCustomer = customerPaymentAllocations.reduce<Record<string, number>>(
    (totals, allocation) => {
      const salesTransactionId = String(allocation.sales_transaction_id ?? "");
      const transaction = salesTransactionsById[salesTransactionId];
      if (!transaction || transaction.payment_type !== "credit") return totals;
      totals[transaction.customer_id] =
        (totals[transaction.customer_id] ?? 0) + safeNumber(allocation.amount);
      return totals;
    },
    {}
  );
  const legacyUnallocatedPaymentPoolByCustomer = customers.reduce<Record<string, number>>(
    (pools, customer) => {
      pools[customer.id] = Math.max(
        0,
        (totalCustomerPaymentsByCustomer[customer.id] ?? 0) -
          (explicitAllocatedPaymentsByCustomer[customer.id] ?? 0)
      );
      return pools;
    },
    {}
  );
  const currentSalesInvoiceTotal = salesLines.reduce(
    (sum, line) => sum + safeNumber(line.quantity) * safeNumber(line.selling_price),
    0
  );
  const todayDateValue = toDateInputValue(new Date());
  const creditAllocationByTransaction = salesTransactions
    .filter((transaction) => transaction.payment_type === "credit")
    .sort((a, b) => {
      const aDate = getDateOnly(a.sale_date) ?? getDateOnly(a.created_at) ?? "";
      const bDate = getDateOnly(b.sale_date) ?? getDateOnly(b.created_at) ?? "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .reduce<
      Record<
        string,
        {
          invoiceTotal: number;
          explicitAllocatedAmount: number;
          fallbackAllocatedAmount: number;
          allocatedAmount: number;
          remainingUnpaidAmount: number;
        }
      >
    >((allocations, transaction) => {
      const invoiceTotal = salesInvoiceTotalsByTransaction[transaction.id] ?? 0;
      const explicitAllocatedAmount = Math.max(
        0,
        explicitAllocatedAmountsBySalesTransaction[transaction.id] ?? 0
      );
      const remainingAfterExplicitAllocation = Math.max(0, invoiceTotal - explicitAllocatedAmount);
      const availableLegacyPool = legacyUnallocatedPaymentPoolByCustomer[transaction.customer_id] ?? 0;
      const fallbackAllocatedAmount = Math.min(
        availableLegacyPool,
        remainingAfterExplicitAllocation
      );

      legacyUnallocatedPaymentPoolByCustomer[transaction.customer_id] = Math.max(
        0,
        availableLegacyPool - fallbackAllocatedAmount
      );
      allocations[transaction.id] = {
        invoiceTotal,
        explicitAllocatedAmount,
        fallbackAllocatedAmount,
        allocatedAmount: explicitAllocatedAmount + fallbackAllocatedAmount,
        remainingUnpaidAmount: Math.max(
          0,
          remainingAfterExplicitAllocation - fallbackAllocatedAmount
        ),
      };
      return allocations;
    }, {});
  const selectedCustomerOutstandingBalance = selectedCustomerCreditTransactionIds.reduce(
    (sum, transactionId) =>
      sum + Math.max(0, creditAllocationByTransaction[transactionId]?.remainingUnpaidAmount ?? 0),
    0
  );
  const projectedCustomerBalance = selectedCustomerOutstandingBalance + currentSalesInvoiceTotal;
  const unpaidCreditInvoicesForSelectedPaymentCustomer = salesTransactions
    .filter(
      (transaction) =>
        transaction.customer_id === selectedCustomerPaymentId &&
        transaction.payment_type === "credit"
    )
    .map((transaction) => {
      const allocation = creditAllocationByTransaction[transaction.id];
      const invoiceTotal = allocation?.invoiceTotal ?? salesInvoiceTotalsByTransaction[transaction.id] ?? 0;
      const explicitAllocatedAmount = allocation?.explicitAllocatedAmount ?? 0;
      const fallbackAllocatedAmount = allocation?.fallbackAllocatedAmount ?? 0;
      const allocatedAmount = allocation?.allocatedAmount ?? explicitAllocatedAmount;
      const remainingUnpaidAmount = Math.max(0, allocation?.remainingUnpaidAmount ?? 0);
      const creditDueDate = getDateOnly(transaction.credit_due_date);
      const status =
        remainingUnpaidAmount <= 0
          ? "Paid"
          : creditDueDate && creditDueDate < todayDateValue
            ? "Overdue"
            : "Credit outstanding";
      return {
        transaction,
        invoiceTotal,
        explicitAllocatedAmount,
        fallbackAllocatedAmount,
        allocatedAmount,
        remainingUnpaidAmount,
        creditDueDate,
        status,
      };
    })
    .filter((invoice) => invoice.remainingUnpaidAmount > 0)
    .sort((a, b) => {
      const aDate = getDateOnly(a.transaction.sale_date) ?? getDateOnly(a.transaction.created_at) ?? "";
      const bDate = getDateOnly(b.transaction.sale_date) ?? getDateOnly(b.transaction.created_at) ?? "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return new Date(a.transaction.created_at).getTime() - new Date(b.transaction.created_at).getTime();
    });
  const customerPaymentAllocationTotal = Object.values(customerPaymentAllocationsByInvoice).reduce(
    (sum, value) => sum + safeNumber(value),
    0
  );
  const customerPaymentAmountValue = safeNumber(customerPaymentAmount);
  const customerPaymentUnallocatedAmount = Math.max(
    0,
    (Number.isFinite(customerPaymentAmountValue) ? customerPaymentAmountValue : 0) -
      customerPaymentAllocationTotal
  );
  const selectedCustomerOverdueCreditInvoices = selectedCustomerCreditTransactionIds
    .map((transactionId) => {
      const transaction = salesTransactions.find((tx) => tx.id === transactionId);
      const allocation = creditAllocationByTransaction[transactionId];
      return {
        transaction,
        remainingUnpaidAmount: allocation?.remainingUnpaidAmount ?? 0,
      };
    })
    .filter(
      ({ transaction, remainingUnpaidAmount }) =>
        Boolean(transaction?.credit_due_date) &&
        remainingUnpaidAmount > 0 &&
        getDateOnly(transaction?.credit_due_date) !== null &&
        getDateOnly(transaction?.credit_due_date)! < todayDateValue
    );
  const selectedCustomerOverdueInvoiceCount = selectedCustomerOverdueCreditInvoices.length;
  const selectedCustomerTotalOverdueAmount = selectedCustomerOverdueCreditInvoices.reduce(
    (sum, invoice) => sum + invoice.remainingUnpaidAmount,
    0
  );
  const selectedCustomerOldestOverdueDueDate =
    selectedCustomerOverdueCreditInvoices
      .map((invoice) => getDateOnly(invoice.transaction?.credit_due_date))
      .filter((date): date is string => Boolean(date))
      .sort()[0] ?? null;
  const customerPaymentHistory = customerPayments
    .map((payment) => {
      const paymentId = String(payment.id ?? "");
      const paymentAmount = safeNumber(payment.amount);
      const allocations = customerPaymentAllocations
        .filter((allocation) => String(allocation.customer_payment_id ?? "") === paymentId)
        .map((allocation) => {
          const transaction = salesTransactionsById[String(allocation.sales_transaction_id ?? "")];
          return {
            allocation,
            transaction,
            amount: safeNumber(allocation.amount),
          };
        });
      const explicitlyAllocatedAmount = allocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0
      );

      return {
        payment,
        customer: customers.find((customer) => customer.id === payment.customer_id),
        paymentAmount,
        allocations,
        explicitlyAllocatedAmount,
        unallocatedAmount: Math.max(0, paymentAmount - explicitlyAllocatedAmount),
        allocationExceedsPayment: explicitlyAllocatedAmount > paymentAmount,
      };
    })
    .sort((a, b) => {
      const aDate = getDateOnly(a.payment.created_at) ?? "";
      const bDate = getDateOnly(b.payment.created_at) ?? "";
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return String(b.payment.id ?? "").localeCompare(String(a.payment.id ?? ""));
    });

  // Inventory calculations per product
  const purchaseTransactionIds = purchaseTransactions.map((tx) => tx.id);
  const salesTransactionIds = salesTransactions.map((tx) => tx.id);
  const filteredPurchaseItems = purchaseItems.filter((pi) => purchaseTransactionIds.includes(pi.purchase_transaction_id));
  const filteredSalesItems = salesItems.filter((si) => salesTransactionIds.includes(si.sales_transaction_id));

  const inventoryStats = products.map((product) => {
    const purchasedQty = filteredPurchaseItems
      .filter((pi) => String(pi.product_id) === String(product.id))
      .reduce((sum, pi) => sum + Number(pi.quantity || 0), 0);

    const soldQty = filteredSalesItems
      .filter((si) => String(si.product_id) === String(product.id))
      .reduce((sum, si) => sum + Number(si.quantity || 0), 0);

    const currentStock = purchasedQty - soldQty;

    return {
      productId: product.id,
      productName: product.name,
      purchasedQty,
      soldQty,
      currentStock,
      defaultSellingPrice: product.default_selling_price ?? null,
      reorderLevel: product.reorder_level ?? 0,
    };
  });

  // Receivables per customer
  const receivablesStats = customers.map((customer) => {
    const customerTxIds = salesTransactions.filter((tx) => tx.customer_id === customer.id).map((t) => t.id);
    const totalSales = salesItems
      .filter((si) => customerTxIds.includes(si.sales_transaction_id))
      .reduce((sum, si) => sum + Number(si.quantity || 0) * Number(si.selling_price || 0), 0);

    const paymentsReceived = customerPayments
      .filter((p) => p.customer_id === customer.id)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return {
      customerId: customer.id,
      customerName: customer.customer_name,
      shopName: customer.shop_name,
      totalSales,
      paymentsReceived,
      outstanding: totalSales - paymentsReceived,
    };
  });

  // Payables per supplier
  const payablesStats = suppliers.map((supplier) => {
    const supplierTxIds = purchaseTransactions
      .filter((tx) => tx.supplier_id === supplier.id)
      .map((t) => t.id);

    const totalPurchases = filteredPurchaseItems
      .filter((pi) => supplierTxIds.includes(pi.purchase_transaction_id))
      .reduce((sum, pi) => sum + Number(pi.quantity || 0) * Number(pi.purchase_price || 0), 0);

    const paymentsMade = supplierPayments
      .filter((p) => p.supplier_id === supplier.id)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const remainingPayable = totalPurchases - paymentsMade;

    console.log("Payables Debug", {
      supplierName: supplier.supplier_name,
      totalPurchases,
      paymentsMade,
      remainingPayable,
    });

    return {
      supplierId: supplier.id,
      supplierName: supplier.supplier_name,
      totalPurchases,
      paymentsMade,
      remainingPayable,
    };
  });

  const totalProducts = products.length;
  const totalCustomers = customers.length;
  const totalSuppliers = suppliers.length;
  const totalReceivables = receivablesStats.reduce((sum, customer) => sum + customer.outstanding, 0);
  const totalPayables = payablesStats.reduce((sum, supplier) => sum + supplier.remainingPayable, 0);
  const inventoryValue = inventoryStats.reduce(
    (sum, item) => sum + item.currentStock * (Number(item.defaultSellingPrice ?? 0) || 0),
    0
  );
  const lowStockProducts = inventoryStats.filter(
    (item) => typeof item.reorderLevel === "number" && item.currentStock <= item.reorderLevel
  );
  const topSellingProducts = products
    .map((product) => {
      const quantitySold = filteredSalesItems
        .filter((si) => String(si.product_id) === String(product.id))
        .reduce((sum, si) => sum + Number(si.quantity || 0), 0);
      return {
        productId: product.id,
        productName: product.name,
        quantitySold,
      };
    })
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, 10);
  const recentSalesInvoices = salesTransactions
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);
  const recentPurchaseInvoices = purchaseTransactions
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);
  const handleProfitLossStartDateChange = (value: string) => {
    setProfitLossStartDate(value);
    if (value && profitLossEndDate && profitLossEndDate < value) {
      setProfitLossEndDate(value);
    }
    setProfitLossDateError(null);
  };
  const handleProfitLossEndDateChange = (value: string) => {
    if (profitLossStartDate && value && value < profitLossStartDate) {
      setProfitLossDateError("End Date cannot be earlier than Start Date.");
      return;
    }
    setProfitLossEndDate(value);
    setProfitLossDateError(null);
  };
  const applyProfitLossMonthRange = (monthOffset: number) => {
    const range = getMonthRange(monthOffset);
    setProfitLossStartDate(range.start);
    setProfitLossEndDate(range.end);
    setProfitLossDateError(null);
  };
  const applyProfitLossAllTime = () => {
    setProfitLossStartDate("");
    setProfitLossEndDate("");
    setProfitLossDateError(null);
  };
  const salesTransactionsInPeriod = salesTransactions.filter((transaction) =>
    isDateInRange(transaction.sale_date, profitLossStartDate, profitLossEndDate)
  );
  const salesTransactionIdsInPeriod = salesTransactionsInPeriod.map((transaction) => transaction.id);
  const salesItemsInPeriod = salesItems.filter((item) =>
    salesTransactionIdsInPeriod.includes(item.sales_transaction_id)
  );
  const expensesInPeriod = expenses.filter((expense) =>
    isDateInRange(expense.expense_date, profitLossStartDate, profitLossEndDate)
  );
  const profitLossTotals = salesItemsInPeriod.reduce(
    (totals, item) => {
      const quantity = Number(item.quantity || 0);
      const sellingPrice = Number(item.selling_price || 0);
      const revenue = quantity * sellingPrice;
      const purchasePriceSnapshot = Number(item.purchase_price_snapshot);
      const hasValidCost =
        Number.isFinite(purchasePriceSnapshot) && purchasePriceSnapshot > 0;

      totals.totalRevenue += revenue;

      if (hasValidCost) {
        totals.knownCostOfGoodsSold += quantity * purchasePriceSnapshot;
        totals.costedSalesRevenue += revenue;
      } else {
        totals.missingCostSalesValue += revenue;
        totals.missingCostSalesLineCount += 1;
      }

      return totals;
    },
    {
      totalRevenue: 0,
      knownCostOfGoodsSold: 0,
      missingCostSalesValue: 0,
      costedSalesRevenue: 0,
      missingCostSalesLineCount: 0,
    }
  );
  const purchaseLinkedExpenses = expensesInPeriod
    .filter((expense) => Boolean(expense.purchase_transaction_id))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const operatingExpenses = expensesInPeriod
    .filter((expense) => !expense.purchase_transaction_id)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const totalRecordedExpenses = purchaseLinkedExpenses + operatingExpenses;
  const grossProfitOnCostedSales =
    profitLossTotals.costedSalesRevenue - profitLossTotals.knownCostOfGoodsSold;
  const mvpNetProfit =
    profitLossTotals.totalRevenue -
    profitLossTotals.knownCostOfGoodsSold -
    totalRecordedExpenses;
  const costCoverage =
    profitLossTotals.totalRevenue > 0
      ? (profitLossTotals.costedSalesRevenue / profitLossTotals.totalRevenue) * 100
      : 100;
  const hasMissingSalesCost = profitLossTotals.missingCostSalesLineCount > 0;
  const netProfitLabel = hasMissingSalesCost
    ? "Estimated Net Profit — incomplete cost data"
    : "Net Profit";

  const expenseCategoryBreakdown = Object.values(
    expensesInPeriod.reduce<Record<string, { expenseType: string; entryCount: number; totalAmount: number }>>(
      (groups, expense) => {
        const expenseType = expense.expense_type || "Uncategorized";
        if (!groups[expenseType]) {
          groups[expenseType] = {
            expenseType,
            entryCount: 0,
            totalAmount: 0,
          };
        }

        groups[expenseType].entryCount += 1;
        groups[expenseType].totalAmount += Number(expense.amount || 0);
        return groups;
      },
      {}
    )
  ).sort((a, b) => b.totalAmount - a.totalAmount);
  const productProfitability = Object.values(
    salesItemsInPeriod.reduce<
      Record<
        string,
        {
          productId: string;
          productName: string;
          quantitySold: number;
          revenue: number;
          cost: number;
          grossProfit: number;
          hasUnknownCostLines: boolean;
        }
      >
    >((groups, item) => {
      const productId = String(item.product_id ?? "");
      if (!productId) return groups;

      const product = products.find((p) => String(p.id) === productId);
      const productName = product?.name ?? "Unknown Product";
      const quantity = Number(item.quantity || 0);
      const sellingPrice = Number(item.selling_price || 0);
      const revenue = quantity * sellingPrice;
      const purchasePriceSnapshot = Number(item.purchase_price_snapshot);
      const hasValidCost =
        Number.isFinite(purchasePriceSnapshot) && purchasePriceSnapshot > 0;

      if (!groups[productId]) {
        groups[productId] = {
          productId,
          productName,
          quantitySold: 0,
          revenue: 0,
          cost: 0,
          grossProfit: 0,
          hasUnknownCostLines: false,
        };
      }

      if (hasValidCost) {
        const cost = quantity * purchasePriceSnapshot;
        groups[productId].quantitySold += quantity;
        groups[productId].revenue += revenue;
        groups[productId].cost += cost;
        groups[productId].grossProfit += revenue - cost;
      } else {
        groups[productId].hasUnknownCostLines = true;
      }

      return groups;
    }, {})
  )
    .filter((product) => product.revenue > 0)
    .map((product) => ({
      ...product,
      marginPercentage:
        product.revenue > 0 ? (product.grossProfit / product.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, 10);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading(true);

    console.log({
      brand_id: selectedBrandId,
      category_id: selectedCategoryId,
    });

    if (!currentOrganizationId) {
      setError("Organization not loaded. Please login again.");
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from("products").insert({
      name,
      brand_id: selectedBrandId,
      category_id: selectedCategoryId,
      unit_type: unitType,
      units_per_pack: unitsPerPack ? Number(unitsPerPack) : null,
      minimum_stock_level: minimumStockLevel ? Number(minimumStockLevel) : null,
      reorder_level: reorderLevel ? Number(reorderLevel) : 0,
      track_batch: trackBatch,
      track_expiry: trackExpiry,
      organization_id: currentOrganizationId,
    });

    setLoading(false);

    if (insertError) {
      setError("Failed to save product");
      console.error("Supabase insert error:", insertError);
      return;
    }

    setMessage("Product saved successfully");
    setName("");
    setUnitType("");
    setUnitsPerPack("");
    setMinimumStockLevel("");
    setTrackBatch(false);
    setTrackExpiry(false);
    setReorderLevel("");
    setSelectedBrandId(null);
    setSelectedCategoryId(null);
    fetchProducts();
  };

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-xl rounded-xl bg-white p-6 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold text-gray-900">
          TradeOS Product Management
        </h1>

        <section className="mb-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Authentication</h2>
          {currentUser ? (
            <div className="space-y-3 text-sm text-gray-700">
              <div>Logged in as: <span className="font-medium text-gray-900">{currentUser.email}</span></div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={authLoading}
                className="rounded bg-red-600 px-4 py-2 text-white transition hover:bg-red-700 disabled:bg-red-300"
              >
                {authLoading ? "Processing..." : "Logout"}
              </button>
              {authMessage && <p className="text-sm text-green-700">{authMessage}</p>}
              {authError && <p className="text-sm text-red-700">{authError}</p>}
              {currentUser && !currentProfile && (
                <p className="text-sm text-red-700">Profile not found. Please contact support.</p>
              )}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded border border-gray-200 bg-white p-4">
                <h3 className="mb-3 text-lg font-medium text-gray-900">Create Account</h3>
                <div className="space-y-3 text-sm text-gray-700">
                  <label className="block">
                    <span className="text-gray-700">Full Name</span>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-gray-700">Organization Name</span>
                    <input
                      type="text"
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-gray-700">Email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-gray-700">Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleSignUp}
                    disabled={authLoading}
                    className="mt-2 w-full rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:bg-blue-300"
                  >
                    {authLoading ? "Processing..." : "Create Account"}
                  </button>
                </div>
              </div>

              <div className="rounded border border-gray-200 bg-white p-4">
                <h3 className="mb-3 text-lg font-medium text-gray-900">Login</h3>
                <div className="space-y-3 text-sm text-gray-700">
                  <label className="block">
                    <span className="text-gray-700">Email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-gray-700">Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleLogin}
                    disabled={authLoading}
                    className="mt-2 w-full rounded bg-green-600 px-4 py-2 text-white transition hover:bg-green-700 disabled:bg-green-300"
                  >
                    {authLoading ? "Processing..." : "Login"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {!currentUser && (authMessage || authError) && (
            <div className="mt-4">
              {authMessage && <p className="text-sm text-green-700">{authMessage}</p>}
              {authError && <p className="text-sm text-red-700">{authError}</p>}
            </div>
          )}
        </section>

        <section className="mb-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Management Dashboard</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Products</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{totalProducts}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Customers</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{totalCustomers}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Suppliers</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{totalSuppliers}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Receivables</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{totalReceivables.toFixed(2)}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Payables</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{totalPayables.toFixed(2)}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Inventory Value</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{inventoryValue.toFixed(2)}</div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Low Stock Products</h3>
              {lowStockProducts.length === 0 ? (
                <p className="text-sm text-gray-600">No low stock products.</p>
              ) : (
                <ul className="space-y-2">
                  {lowStockProducts.map((item) => (
                    <li key={item.productId} className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{item.productName}</div>
                          <div className="text-xs text-gray-500">Reorder Level: {item.reorderLevel}</div>
                        </div>
                        <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">REORDER REQUIRED</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-600">Current Stock: {item.currentStock}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Top Selling Products</h3>
              {topSellingProducts.length === 0 ? (
                <p className="text-sm text-gray-600">No sales yet.</p>
              ) : (
                <ul className="space-y-2">
                  {topSellingProducts.map((item) => (
                    <li key={item.productId} className="flex items-center justify-between rounded border border-gray-200 bg-gray-50 px-3 py-2">
                      <span className="text-sm text-gray-900">{item.productName}</span>
                      <span className="text-sm font-semibold text-gray-700">{item.quantitySold}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Recent Sales</h3>
              {recentSalesInvoices.length === 0 ? (
                <p className="text-sm text-gray-600">No recent sales.</p>
              ) : (
                <ul className="space-y-2">
                  {recentSalesInvoices.map((tx) => {
                    const customer = customers.find((c) => c.id === tx.customer_id);
                    return (
                      <li key={tx.id} className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                        <div className="text-sm font-medium text-gray-900">{tx.invoice_number}</div>
                        <div className="text-xs text-gray-500">{customer?.customer_name ?? "Unknown Customer"}</div>
                        <div className="text-xs text-gray-500">{new Date(tx.created_at).toLocaleDateString()}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Recent Purchases</h3>
              {recentPurchaseInvoices.length === 0 ? (
                <p className="text-sm text-gray-600">No recent purchases.</p>
              ) : (
                <ul className="space-y-2">
                  {recentPurchaseInvoices.map((tx) => {
                    const supplier = suppliers.find((s) => s.id === tx.supplier_id);
                    return (
                      <li key={tx.id} className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                        <div className="text-sm font-medium text-gray-900">{tx.invoice_number}</div>
                        <div className="text-xs text-gray-500">{supplier?.supplier_name ?? "Unknown Supplier"}</div>
                        <div className="text-xs text-gray-500">{new Date(tx.created_at).toLocaleDateString()}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="mb-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Profit Dashboard</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Start Date</span>
              <input
                type="date"
                value={profitLossStartDate}
                onChange={(e) => handleProfitLossStartDateChange(e.target.value)}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>End Date</span>
              <input
                type="date"
                value={profitLossEndDate}
                min={profitLossStartDate || undefined}
                onChange={(e) => handleProfitLossEndDateChange(e.target.value)}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => applyProfitLossMonthRange(0)}
              className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => applyProfitLossMonthRange(-1)}
              className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
            >
              Last Month
            </button>
            <button
              type="button"
              onClick={applyProfitLossAllTime}
              className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
            >
              All Time
            </button>
          </div>

          {profitLossDateError && (
            <p className="mt-3 text-sm text-red-700">{profitLossDateError}</p>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Revenue</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">
                {pkrFormatter.format(profitLossTotals.totalRevenue)}
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Known Cost of Goods Sold</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">
                {pkrFormatter.format(profitLossTotals.knownCostOfGoodsSold)}
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Gross Profit on Costed Sales</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">
                {pkrFormatter.format(grossProfitOnCostedSales)}
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Purchase-Linked Expenses</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">
                {pkrFormatter.format(purchaseLinkedExpenses)}
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Operating Expenses</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">
                {pkrFormatter.format(operatingExpenses)}
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Recorded Expenses</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">
                {pkrFormatter.format(totalRecordedExpenses)}
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">{netProfitLabel}</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">
                {pkrFormatter.format(mvpNetProfit)}
              </div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Cost Coverage</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">
                {costCoverage.toFixed(2)}%
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Sales invoices in period</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{salesTransactionsInPeriod.length}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Sales lines in period</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{salesItemsInPeriod.length}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Expense entries in period</div>
              <div className="mt-2 text-2xl font-semibold text-gray-900">{expensesInPeriod.length}</div>
            </div>
          </div>

          {costCoverage < 100 && (
            <div className="mt-5 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">
                Some sales do not contain a purchase-cost snapshot. Profit is estimated and may be overstated.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>Sales lines missing cost: {profitLossTotals.missingCostSalesLineCount}</div>
                <div>
                  Revenue affected by missing cost: {pkrFormatter.format(profitLossTotals.missingCostSalesValue)}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Expense Category Breakdown</h3>
              {expenseCategoryBreakdown.length === 0 ? (
                <p className="text-sm text-gray-600">No expenses in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-gray-500">
                      <tr>
                        <th className="py-2 pr-3">Expense Type</th>
                        <th className="py-2 pr-3">Entries</th>
                        <th className="py-2 text-right">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {expenseCategoryBreakdown.map((category) => (
                        <tr key={category.expenseType}>
                          <td className="py-2 pr-3 font-medium text-gray-900">{category.expenseType}</td>
                          <td className="py-2 pr-3 text-gray-700">{category.entryCount}</td>
                          <td className="py-2 text-right font-medium text-gray-900">
                            {pkrFormatter.format(category.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Top Product Profitability</h3>
              {productProfitability.length === 0 ? (
                <p className="text-sm text-gray-600">No costed product sales in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-gray-500">
                      <tr>
                        <th className="py-2 pr-3">Product</th>
                        <th className="py-2 pr-3">Qty</th>
                        <th className="py-2 pr-3">Revenue</th>
                        <th className="py-2 pr-3">Cost</th>
                        <th className="py-2 pr-3">Gross Profit</th>
                        <th className="py-2 text-right">Margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {productProfitability.map((product) => (
                        <tr key={product.productId}>
                          <td className="py-2 pr-3">
                            <div className="font-medium text-gray-900">{product.productName}</div>
                            {product.hasUnknownCostLines && (
                              <div className="text-xs text-amber-700">Partial cost data</div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-gray-700">{product.quantitySold}</td>
                          <td className="py-2 pr-3 text-gray-700">{pkrFormatter.format(product.revenue)}</td>
                          <td className="py-2 pr-3 text-gray-700">{pkrFormatter.format(product.cost)}</td>
                          <td className="py-2 pr-3 font-medium text-gray-900">
                            {pkrFormatter.format(product.grossProfit)}
                          </td>
                          <td className="py-2 text-right font-medium text-gray-900">
                            {product.marginPercentage.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mb-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Brand Management</h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Brand Name</span>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={handleAddBrand}
              disabled={brandsLoading}
              className="h-12 rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              Add Brand
            </button>
          </div>

          {brandMessage && <p className="mt-4 text-sm text-green-700">{brandMessage}</p>}
          {brandError && <p className="mt-4 text-sm text-red-700">{brandError}</p>}

          <div className="mt-6">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Existing Brands</h3>
            {brandsLoading ? (
              <p className="text-sm text-gray-600">Loading brands...</p>
            ) : brands.length === 0 ? (
              <p className="text-sm text-gray-600">No brands found.</p>
            ) : (
              <ul className="space-y-2">
                {brands.map((brand) => (
                  <li
                    key={brand.id}
                    className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2"
                  >
                    <span>{brand.name}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteBrand(brand.id)}
                      className="rounded bg-red-600 px-3 py-1 text-sm text-white transition hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Inventory Dashboard</h2>
          {products.length === 0 ? (
            <p className="text-sm text-gray-600">No products to show.</p>
          ) : (
            <ul className="space-y-2">
              {inventoryStats.map((s) => (
                <li
                  key={s.productId}
                  className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2"
                >
                  <div>
                    <div className="font-medium text-gray-900">{s.productName}</div>
                    <div className="text-xs text-gray-600">Default Price: {s.defaultSellingPrice ?? "-"}</div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-700">
                    <div>Purchased: {s.purchasedQty}</div>
                    <div>Sold: {s.soldQty}</div>
                    <div>Stock: {s.currentStock}</div>
                    {s.currentStock <= 10 && (
                      <span className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">LOW STOCK</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Sales Invoice</h2>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Customer</span>
                <select
                  value={selectedCustomerIdForSale ?? ""}
                  onChange={(e) => handleSalesCustomerChange(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select Customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.customer_name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Invoice Number</span>
                <input
                  type="text"
                  value={salesInvoiceNumber}
                  onChange={(e) => setSalesInvoiceNumber(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Sale Date</span>
                <input
                  type="date"
                  value={salesInvoiceDate}
                  onChange={(e) => handleSalesInvoiceDateChange(e.target.value)}
                  required
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Payment Type</span>
                <select
                  value={salesPaymentType}
                  onChange={(e) => handleSalesPaymentTypeChange(e.target.value as "cash" | "credit")}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="cash">Cash</option>
                  <option value="credit">Credit</option>
                </select>
              </label>
            </div>

            {salesPaymentType === "credit" && selectedSalesCustomer && (
              <div className="rounded border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
                <h3 className="mb-2 text-base font-medium text-blue-950">Credit Summary</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>Customer credit policy: {creditPolicyLabels[selectedCustomerCreditPolicy] ?? "Cash Only"}</div>
                  <div>Current outstanding balance: {pkrFormatter.format(selectedCustomerOutstandingBalance)}</div>
                  <div>Current invoice total: {pkrFormatter.format(currentSalesInvoiceTotal)}</div>
                  <div>Projected balance: {pkrFormatter.format(projectedCustomerBalance)}</div>
                  {policyUsesCreditLimit(selectedCustomerCreditPolicy) && (
                    <div>Credit limit: {pkrFormatter.format(selectedCustomerCreditLimit)}</div>
                  )}
                  {(policyUsesCreditDays(selectedCustomerCreditPolicy) ||
                    selectedCustomerHasUsableUnrestrictedCreditDays) && (
                    <div>Credit days: {selectedCustomerCreditDays}</div>
                  )}
                </div>
              </div>
            )}

            {creditWarning && (
              <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {creditWarning}
              </p>
            )}

            {creditOverrideConfirmation && salesPaymentType === "credit" && (
              <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <h3 className="mb-2 text-base font-medium">Owner Override Required</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>Current outstanding balance: {pkrFormatter.format(selectedCustomerOutstandingBalance)}</div>
                  <div>Current invoice total: {pkrFormatter.format(currentSalesInvoiceTotal)}</div>
                  <div>Projected balance: {pkrFormatter.format(projectedCustomerBalance)}</div>
                  {creditOverrideConfirmation.overLimit && (
                    <>
                      <div>Credit limit: {pkrFormatter.format(selectedCustomerCreditLimit)}</div>
                      <div>
                        Over-limit amount: {pkrFormatter.format(Math.max(0, projectedCustomerBalance - selectedCustomerCreditLimit))}
                      </div>
                    </>
                  )}
                  {creditOverrideConfirmation.overdue && (
                    <>
                      <div>Overdue invoices: {selectedCustomerOverdueInvoiceCount}</div>
                      <div>Total overdue amount: {pkrFormatter.format(selectedCustomerTotalOverdueAmount)}</div>
                      <div>Oldest overdue date: {selectedCustomerOldestOverdueDueDate ?? "Unknown"}</div>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => handleCreateSalesInvoice(true)}
                    disabled={salesInvoiceLoading}
                    className="rounded bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700 disabled:bg-amber-300"
                  >
                    Confirm and Save Credit Sale
                  </button>
                  <button
                    type="button"
                    onClick={clearCreditOverrideState}
                    disabled={salesInvoiceLoading}
                    className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Product Lines</h3>

              {salesLines.length === 0 ? (
                <p className="mb-4 text-sm text-gray-500">No product lines added yet.</p>
              ) : (
                <div className="mb-4 space-y-3">
                  {salesLines.map((line, index) => (
                    <div key={index} className="rounded border border-gray-300 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Line {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSalesLine(index)}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Product</span>
                          <select
                            value={line.product_id ?? ""}
                            onChange={(e) => handleSalesLineChange(index, "product_id", e.target.value === "" ? null : e.target.value)}
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="">Select Product</option>
                            {products.map((product) => (
                              <option key={product.id} value={String(product.id)}>{product.name}</option>
                            ))}
                          </select>
                        </label>

                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Quantity</span>
                          <input
                            type="number"
                            value={line.quantity}
                            onChange={(e) => handleSalesLineChange(index, "quantity", e.target.value)}
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          />
                        </label>

                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Selling Price</span>
                          <input
                            type="number"
                            value={line.selling_price}
                            onChange={(e) => handleSalesLineChange(index, "selling_price", e.target.value)}
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={handleAddSalesLine}
                className="mb-4 rounded border border-blue-600 px-4 py-2 text-sm text-blue-600 transition hover:bg-blue-50"
              >
                + Add Product Line
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleCreateSalesInvoice()}
              disabled={salesInvoiceLoading}
              className="w-full rounded bg-green-600 px-4 py-2 text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
            >
              {salesInvoiceLoading ? "Saving..." : "Save Sales Invoice"}
            </button>

            {salesMessage && <p className="mt-4 text-sm text-green-700">{salesMessage}</p>}
            {salesError && <p className="mt-4 text-sm text-red-700">{salesError}</p>}
          </div>
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Sales History</h2>
          <p className="mb-3 text-xs text-gray-500">
            Older unallocated customer payments are applied to the oldest credit invoices first.
          </p>
          {salesLoading ? (
            <p className="text-sm text-gray-600">Loading sales history...</p>
          ) : salesTransactions.length === 0 ? (
            <p className="text-sm text-gray-600">No sales invoices found.</p>
          ) : (
            <ul className="space-y-2">
              {salesTransactions.map((tx) => {
                const customer = customers.find((c) => c.id === tx.customer_id);
                const date = new Date(tx.created_at).toLocaleDateString();
                const paymentType = tx.payment_type ?? "cash";
                const creditAllocation = creditAllocationByTransaction[tx.id];
                const remainingUnpaidAmount = creditAllocation?.remainingUnpaidAmount ?? 0;
                const creditDueDate = getDateOnly(tx.credit_due_date);
                const creditStatus =
                  paymentType === "cash"
                    ? "Cash"
                    : remainingUnpaidAmount <= 0
                      ? "Paid"
                      : creditDueDate && creditDueDate < todayDateValue
                        ? "Overdue"
                        : "Credit outstanding";
                return (
                  <li key={tx.id} className="flex flex-col gap-1 rounded border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
                    <div className="font-medium text-gray-900">Invoice: {tx.invoice_number}</div>
                    <div>Customer: {customer?.customer_name ?? "Unknown"}</div>
                    <div className="text-xs text-gray-500">Date: {date}</div>
                    <div>Payment Type: {paymentType === "credit" ? "Credit" : "Cash"}</div>
                    <div>Status: {creditStatus}</div>
                    {paymentType === "credit" && (
                      <>
                        <div>Invoice Total: {pkrFormatter.format(creditAllocation?.invoiceTotal ?? 0)}</div>
                        <div>Allocated Payment: {pkrFormatter.format(creditAllocation?.allocatedAmount ?? 0)}</div>
                        <div>Remaining Balance: {pkrFormatter.format(remainingUnpaidAmount)}</div>
                      </>
                    )}
                    {creditDueDate && <div>Credit Due Date: {creditDueDate}</div>}
                    {tx.credit_limit_snapshot != null && (
                      <div>Credit Limit Snapshot: {pkrFormatter.format(Number(tx.credit_limit_snapshot || 0))}</div>
                    )}
                    {tx.credit_days_snapshot != null && (
                      <div>Credit Days Snapshot: {tx.credit_days_snapshot}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Customer Payments</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <select
              value={selectedCustomerPaymentId ?? ""}
              onChange={(e) => handleCustomerPaymentCustomerChange(e.target.value)}
              className="rounded border border-gray-300 px-2 py-2"
            >
              <option value="">Select Customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.customer_name}</option>
              ))}
            </select>

            <input
              type="number"
              value={customerPaymentAmount}
              onChange={(e) => handleCustomerPaymentAmountChange(e.target.value)}
              placeholder="Amount"
              className="rounded border border-gray-300 px-2 py-2"
            />

            <input
              type="text"
              value={customerPaymentNotes}
              onChange={(e) => setCustomerPaymentNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="rounded border border-gray-300 px-2 py-2"
            />
          </div>

          {selectedCustomerPaymentId && (
            <div className="mt-4 rounded border border-gray-200 bg-white p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-medium text-gray-900">Allocate to Credit Invoices</h3>
                <button
                  type="button"
                  onClick={handleAutoAllocateCustomerPayment}
                  className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
                >
                  Auto Allocate Oldest First
                </button>
              </div>
              <p className="mb-3 text-xs text-gray-500">
                Older unallocated customer payments are applied to the oldest credit invoices first.
              </p>

              <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-gray-500">Payment amount</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(Number.isFinite(customerPaymentAmountValue) ? customerPaymentAmountValue : 0)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-gray-500">Total allocated</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(customerPaymentAllocationTotal)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-gray-500">Unallocated amount</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(customerPaymentUnallocatedAmount)}
                  </div>
                </div>
              </div>

              {unpaidCreditInvoicesForSelectedPaymentCustomer.length === 0 ? (
                <p className="text-sm text-gray-600">No unpaid credit invoices for this customer.</p>
              ) : (
                <div className="space-y-3">
                  {unpaidCreditInvoicesForSelectedPaymentCustomer.map((invoice) => (
                    <div key={invoice.transaction.id} className="rounded border border-gray-200 bg-gray-50 p-3">
                      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Invoice</div>
                          <div className="font-medium text-gray-900">{invoice.transaction.invoice_number}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Sale Date</div>
                          <div>{getDateOnly(invoice.transaction.sale_date) ?? "-"}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Invoice Total</div>
                          <div>{pkrFormatter.format(invoice.invoiceTotal)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Allocated</div>
                          <div>{pkrFormatter.format(invoice.allocatedAmount)}</div>
                          {invoice.fallbackAllocatedAmount > 0 && (
                            <div className="text-xs text-gray-500">
                              Includes {pkrFormatter.format(invoice.fallbackAllocatedAmount)} older unallocated payment
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Remaining</div>
                          <div>{pkrFormatter.format(invoice.remainingUnpaidAmount)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Due Date</div>
                          <div>{invoice.creditDueDate ?? "-"}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
                          <div>{invoice.status}</div>
                        </div>
                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Allocation Amount</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={customerPaymentAllocationsByInvoice[invoice.transaction.id] ?? ""}
                            onChange={(e) =>
                              handleCustomerPaymentAllocationChange(invoice.transaction.id, e.target.value)
                            }
                            className="rounded border border-gray-300 px-2 py-1"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-3">
            <button
              type="button"
              onClick={handleSaveCustomerPayment}
              disabled={customerPaymentLoading}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {customerPaymentLoading ? "Saving..." : "Save Customer Payment"}
            </button>
            {customerPaymentMessage && <p className="mt-2 text-sm text-green-700">{customerPaymentMessage}</p>}
            {customerPaymentError && <p className="mt-2 text-sm text-red-700">{customerPaymentError}</p>}
          </div>

          <div className="mt-6 border-t border-gray-200 pt-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Customer Payment History</h3>
            {customerPaymentHistory.length === 0 ? (
              <p className="text-sm text-gray-600">No customer payments recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {customerPaymentHistory.map((historyItem) => (
                  <li
                    key={historyItem.payment.id}
                    className="rounded border border-gray-200 bg-white p-3 text-sm text-gray-700"
                  >
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Customer</div>
                        <div className="font-medium text-gray-900">
                          {historyItem.customer?.customer_name ?? "Unknown"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Payment Date</div>
                        <div>{getDateOnly(historyItem.payment.created_at) ?? "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Total Payment</div>
                        <div>{pkrFormatter.format(historyItem.paymentAmount)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Explicitly Allocated</div>
                        <div>{pkrFormatter.format(historyItem.explicitlyAllocatedAmount)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Unallocated</div>
                        <div>{pkrFormatter.format(historyItem.unallocatedAmount)}</div>
                      </div>
                    </div>

                    {historyItem.payment.notes && (
                      <p className="mt-2 text-sm text-gray-600">Notes: {historyItem.payment.notes}</p>
                    )}

                    {historyItem.unallocatedAmount > 0 && (
                      <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Unallocated payment balance
                      </p>
                    )}
                    {historyItem.allocationExceedsPayment && (
                      <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        Allocation data exceeds payment amount
                      </p>
                    )}

                    {historyItem.allocations.length > 0 && (
                      <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                          Allocations
                        </div>
                        <ul className="space-y-1">
                          {historyItem.allocations.map((allocationItem) => (
                            <li
                              key={allocationItem.allocation.id}
                              className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <span>
                                Sales invoice: {allocationItem.transaction?.invoice_number ?? "Unknown"}
                              </span>
                              <span>{pkrFormatter.format(allocationItem.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Supplier Payments</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <select
              value={selectedSupplierPaymentId ?? ""}
              onChange={(e) => setSelectedSupplierPaymentId(e.target.value === "" ? null : e.target.value)}
              className="rounded border border-gray-300 px-2 py-2"
            >
              <option value="">Select Supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.supplier_name}</option>
              ))}
            </select>

            <input
              type="number"
              value={supplierPaymentAmount}
              onChange={(e) => setSupplierPaymentAmount(e.target.value)}
              placeholder="Amount"
              className="rounded border border-gray-300 px-2 py-2"
            />

            <input
              type="text"
              value={supplierPaymentNotes}
              onChange={(e) => setSupplierPaymentNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="rounded border border-gray-300 px-2 py-2"
            />
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={handleSaveSupplierPayment}
              disabled={supplierPaymentLoading}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {supplierPaymentLoading ? "Saving..." : "Save Supplier Payment"}
            </button>
            {supplierPaymentMessage && <p className="mt-2 text-sm text-green-700">{supplierPaymentMessage}</p>}
            {supplierPaymentError && <p className="mt-2 text-sm text-red-700">{supplierPaymentError}</p>}
          </div>
        </section>

        <section id="expense-management" className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Expense Management</h2>
          <form onSubmit={saveExpense} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Expense Type</span>
                <select
                  value={expenseType}
                  onChange={(e) => setExpenseType(e.target.value)}
                  required
                  className="rounded border border-gray-300 px-2 py-2"
                >
                  <option value="">Select Expense Type</option>
                  {expenseTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Amount</span>
                <input
                  type="number"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  min="0.01"
                  step="0.01"
                  required
                  className="rounded border border-gray-300 px-2 py-2"
                />
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Notes</span>
              <textarea
                value={expenseNotes}
                onChange={(e) => setExpenseNotes(e.target.value)}
                rows={3}
                className="rounded border border-gray-300 px-2 py-2"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Supplier</span>
                <select
                  value={selectedExpenseSupplierId}
                  onChange={(e) => setSelectedExpenseSupplierId(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-2"
                >
                  <option value="">No Supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Customer</span>
                <select
                  value={selectedExpenseCustomerId}
                  onChange={(e) => setSelectedExpenseCustomerId(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-2"
                >
                  <option value="">No Customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.customer_name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Purchase Invoice</span>
                <select
                  value={selectedExpensePurchaseId}
                  onChange={(e) => setSelectedExpensePurchaseId(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-2"
                >
                  <option value="">No Purchase Invoice</option>
                  {purchaseTransactions.map((transaction) => (
                    <option key={transaction.id} value={transaction.id}>{transaction.invoice_number}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Sales Invoice</span>
                <select
                  value={selectedExpenseSaleId}
                  onChange={(e) => setSelectedExpenseSaleId(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-2"
                >
                  <option value="">No Sales Invoice</option>
                  {salesTransactions.map((transaction) => (
                    <option key={transaction.id} value={transaction.id}>{transaction.invoice_number}</option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="submit"
              disabled={expenseLoading}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {expenseLoading ? "Saving..." : "Save Expense"}
            </button>

            {expenseMessage && (
              <p
                className={`text-sm ${
                  expenseMessage.startsWith("Error")
                    ? "text-red-700"
                    : expenseMessage.startsWith("Expense saved, but")
                      ? "text-amber-700"
                      : "text-green-700"
                }`}
              >
                {expenseMessage}
              </p>
            )}
          </form>

          <div className="mt-6">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Recent Expenses</h3>
            {expenses.length === 0 ? (
              <p className="text-sm text-gray-600">No expenses recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {expenses.map((expense) => {
                  const supplier = suppliers.find((s) => s.id === expense.supplier_id);
                  const customer = customers.find((c) => c.id === expense.customer_id);
                  const purchaseTransaction = purchaseTransactions.find(
                    (transaction) => transaction.id === expense.purchase_transaction_id
                  );
                  const salesTransaction = salesTransactions.find(
                    (transaction) => transaction.id === expense.sales_transaction_id
                  );
                  const expenseDate = expense.created_at
                    ? new Date(expense.created_at).toLocaleDateString()
                    : "No date";
                  const formattedAmount = new Intl.NumberFormat("en-PK", {
                    style: "currency",
                    currency: "PKR",
                  }).format(Number(expense.amount || 0));

                  return (
                    <li key={expense.id} className="rounded border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium text-gray-900">{expense.expense_type}</div>
                          <div className="text-xs text-gray-500">Date: {expenseDate}</div>
                        </div>
                        <div className="font-medium text-gray-900">{formattedAmount}</div>
                      </div>
                      {expense.notes && <div className="mt-2">Notes: {expense.notes}</div>}
                      <div className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
                        {expense.supplier_id && <div>Supplier: {supplier?.supplier_name ?? "Unknown"}</div>}
                        {expense.customer_id && <div>Customer: {customer?.customer_name ?? "Unknown"}</div>}
                        {expense.purchase_transaction_id && (
                          <div>Purchase Invoice: {purchaseTransaction?.invoice_number ?? "Unknown"}</div>
                        )}
                        {expense.sales_transaction_id && (
                          <div>Sales Invoice: {salesTransaction?.invoice_number ?? "Unknown"}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Receivables Dashboard</h2>
          {customers.length === 0 ? (
            <p className="text-sm text-gray-600">No customers.</p>
          ) : (
            <ul className="space-y-2">
              {receivablesStats.map((r) => (
                <li key={r.customerId} className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2">
                  <div>
                    <div className="font-medium text-gray-900">{r.customerName}</div>
                    <div className="text-xs text-gray-600">{r.shopName ?? ""}</div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-700">
                    <div>Total Sales: {r.totalSales}</div>
                    <div>Payments: {r.paymentsReceived}</div>
                    <div>Outstanding: {r.outstanding}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Payables Dashboard</h2>
          {suppliers.length === 0 ? (
            <p className="text-sm text-gray-600">No suppliers.</p>
          ) : (
            <ul className="space-y-2">
              {payablesStats.map((p) => (
                <li key={p.supplierId} className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2">
                  <div>
                    <div className="font-medium text-gray-900">{p.supplierName}</div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-700">
                    <div>Total Purchases: {p.totalPurchases}</div>
                    <div>Payments: {p.paymentsMade}</div>
                    <div>Remaining Payable: {p.remainingPayable}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Category Management</h2>
          <div className="space-y-4">
            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Category Name</span>
              <input
                type="text"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Parent Category (Optional)</span>
              <select
                value={parentCategoryId ?? ""}
                onChange={(e) => setParentCategoryId(e.target.value === "" ? null : e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                <option value="">None</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={handleAddCategory}
              disabled={categoriesLoading}
              className="w-full rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              Add Category
            </button>
          </div>

          {categoryMessage && <p className="mt-4 text-sm text-green-700">{categoryMessage}</p>}
          {categoryError && <p className="mt-4 text-sm text-red-700">{categoryError}</p>}

          <div className="mt-6">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Existing Categories</h3>
            {categoriesLoading ? (
              <p className="text-sm text-gray-600">Loading categories...</p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-gray-600">No categories found.</p>
            ) : (
              <ul className="space-y-2">
                {categories.map((category) => {
                  const parentCategory = categories.find((c) => c.id === category.parent_category_id);
                  return (
                    <li
                      key={category.id}
                      className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span>{category.name}</span>
                        {parentCategory && (
                          <span className="text-xs text-gray-500">Parent: {parentCategory.name}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(category.id)}
                        className="rounded bg-red-600 px-3 py-1 text-sm text-white transition hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Product Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Brand
            </label>
            <select
              value={selectedBrandId ?? ""}
              onChange={(e) => setSelectedBrandId(e.target.value === "" ? null : e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="">None</option>
              {brands.map((brand) => (
                <option key={brand.id} value={String(brand.id)}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Category
            </label>
            <select
              value={selectedCategoryId ?? ""}
              onChange={(e) => setSelectedCategoryId(e.target.value === "" ? null : e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Unit Type
            </label>
            <input
              type="text"
              value={unitType}
              onChange={(e) => setUnitType(e.target.value)}
              required
              className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Units Per Pack
            </label>
            <input
              type="number"
              value={unitsPerPack}
              onChange={(e) => setUnitsPerPack(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Minimum Stock Level
            </label>
            <input
              type="number"
              value={minimumStockLevel}
              onChange={(e) => setMinimumStockLevel(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Reorder Level
            </label>
            <input
              type="number"
              value={reorderLevel}
              onChange={(e) => setReorderLevel(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={trackBatch}
                onChange={(e) => setTrackBatch(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Track Batch
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={trackExpiry}
                onChange={(e) => setTrackExpiry(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Track Expiry
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {loading ? "Saving..." : "Save Product"}
          </button>
        </form>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Existing Products</h2>
          {productsLoading ? (
            <p className="text-sm text-gray-600">Loading products...</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-gray-600">No products found.</p>
          ) : (
            <ul className="space-y-2">
              {products.map((product) => {
                const brand = brands.find((b) => b.id === product.brand_id);
                const category = categories.find((c) => c.id === product.category_id);
                return (
                  <li
                    key={product.id}
                    className="flex flex-col gap-2 rounded border border-gray-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-gray-900">{product.name}</div>
                      <div className="text-xs text-gray-500">Brand: {brand?.name ?? "None"}</div>
                      <div className="text-xs text-gray-500">Category: {category?.name ?? "None"}</div>
                      <div className="text-xs text-gray-500">Unit Type: {product.unit_type ?? "None"}</div>
                      <div className="text-xs text-gray-500">Track Batch: {product.track_batch ? "Yes" : "No"}</div>
                      <div className="text-xs text-gray-500">Track Expiry: {product.track_expiry ? "Yes" : "No"}</div>
                      <div className="text-xs text-gray-500">Reorder Level: {product.reorder_level ?? 0}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteProduct(product.id)}
                      className="rounded bg-red-600 px-3 py-1 text-sm text-white transition hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Customer Management</h2>
          <div className="space-y-4">
            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Customer Name</span>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Shop Name</span>
                <input
                  type="text"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Phone</span>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>WhatsApp</span>
                <input
                  type="text"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>City</span>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Area</span>
                <input
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Customer Type</span>
                <select
                  value={customerType}
                  onChange={(e) => setCustomerType(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="Retailer">Retailer</option>
                  <option value="Wholesaler">Wholesaler</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Credit Policy</span>
                <select
                  value={creditPolicy}
                  onChange={(e) => handleCreditPolicyChange(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="cash_only">Cash Only</option>
                  <option value="limit_only">Credit Limit Only</option>
                  <option value="days_only">Credit Days Only</option>
                  <option value="limit_and_days">Credit Limit and Days</option>
                  <option value="unrestricted">Unrestricted Credit</option>
                </select>
              </label>
            </div>

            {(policyUsesCreditLimit(creditPolicy) || policyUsesCreditDays(creditPolicy)) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {policyUsesCreditLimit(creditPolicy) && (
                  <label className="flex flex-col gap-2 text-sm text-gray-700">
                    <span>Credit Limit</span>
                    <input
                      type="number"
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
                      min="0"
                      step="0.01"
                      required
                      className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                )}

                {policyUsesCreditDays(creditPolicy) && (
                  <label className="flex flex-col gap-2 text-sm text-gray-700">
                    <span>Credit Days</span>
                    <input
                      type="number"
                      value={creditDays}
                      onChange={(e) => setCreditDays(e.target.value)}
                      min="0"
                      step="1"
                      required
                      className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                )}
              </div>
            )}

            {(policyUsesCreditLimit(creditPolicy) || policyUsesCreditDays(creditPolicy)) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {policyUsesCreditLimit(creditPolicy) && (
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={allowOverLimit}
                      onChange={(e) => setAllowOverLimit(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span>Allow Sale Above Credit Limit</span>
                  </label>
                )}

                {policyUsesCreditDays(creditPolicy) && (
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={allowOverdueSales}
                      onChange={(e) => setAllowOverdueSales(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span>Allow Sale When Previous Credit Is Overdue</span>
                  </label>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleAddCustomer}
              disabled={customersLoading}
              className="w-full rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              Save Customer
            </button>
          </div>

          {customerMessage && <p className="mt-4 text-sm text-green-700">{customerMessage}</p>}
          {customerError && <p className="mt-4 text-sm text-red-700">{customerError}</p>}

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Search Customers</label>
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search by name, shop, or phone"
                className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <h3 className="mb-3 text-lg font-medium text-gray-900">Existing Customers</h3>
              {customersLoading ? (
                <p className="text-sm text-gray-600">Loading customers...</p>
              ) : filteredCustomers.length === 0 ? (
                <p className="text-sm text-gray-600">No customers found.</p>
              ) : (
                <ul className="space-y-2">
                  {filteredCustomers.map((customer) => {
                    const policy = customer.credit_policy ?? "cash_only";
                    const policyLabel = creditPolicyLabels[policy] ?? creditPolicyLabels.cash_only;
                    const creditLimitSummary = pkrFormatter.format(Number(customer.credit_limit || 0));
                    const creditDaysSummary = Number(customer.credit_days || 0);
                    const creditSummary =
                      policy === "limit_only"
                        ? `Limit: ${creditLimitSummary}`
                        : policy === "days_only"
                          ? `Terms: ${creditDaysSummary} days`
                          : policy === "limit_and_days"
                            ? `Limit + Terms: ${creditLimitSummary}, ${creditDaysSummary} days`
                            : policyLabel;

                    return (
                      <li
                        key={customer.id}
                        className="flex flex-col gap-2 rounded border border-gray-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1 text-sm text-gray-700">
                          <div className="font-medium text-gray-900">{customer.customer_name}</div>
                          <div>Shop: {customer.shop_name ?? "None"}</div>
                          <div>Type: {customer.customer_type ?? "None"}</div>
                          <div>Phone: {customer.phone ?? "None"}</div>
                          <div>City: {customer.city ?? "None"}</div>
                          <div>Credit Policy: {creditSummary}</div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            {customer.allow_over_limit && (
                              <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">
                                Above-limit sales allowed
                              </span>
                            )}
                            {customer.allow_overdue_sales && (
                              <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">
                                Overdue sales allowed
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomer(customer.id)}
                          className="rounded bg-red-600 px-3 py-1 text-sm text-white transition hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Supplier Management</h2>
          <div className="space-y-4">
            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Supplier Name</span>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                required
                className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Contact Person</span>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Phone</span>
                <input
                  type="text"
                  value={supplierPhone}
                  onChange={(e) => setSupplierPhone(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>WhatsApp</span>
                <input
                  type="text"
                  value={supplierWhatsapp}
                  onChange={(e) => setSupplierWhatsapp(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>City</span>
                <input
                  type="text"
                  value={supplierCity}
                  onChange={(e) => setSupplierCity(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Notes</span>
              <textarea
                value={supplierNotes}
                onChange={(e) => setSupplierNotes(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                rows={3}
              />
            </label>

            <button
              type="button"
              onClick={handleAddSupplier}
              disabled={suppliersLoading}
              className="w-full rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              Save Supplier
            </button>
          </div>

          {supplierMessage && <p className="mt-4 text-sm text-green-700">{supplierMessage}</p>}
          {supplierError && <p className="mt-4 text-sm text-red-700">{supplierError}</p>}

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Search Suppliers</label>
              <input
                type="text"
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                placeholder="Search by name, contact, or phone"
                className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <h3 className="mb-3 text-lg font-medium text-gray-900">Existing Suppliers</h3>
              {suppliersLoading ? (
                <p className="text-sm text-gray-600">Loading suppliers...</p>
              ) : filteredSuppliers.length === 0 ? (
                <p className="text-sm text-gray-600">No suppliers found.</p>
              ) : (
                <ul className="space-y-2">
                  {filteredSuppliers.map((supplier) => (
                    <li
                      key={supplier.id}
                      className="flex flex-col gap-2 rounded border border-gray-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1 text-sm text-gray-700">
                        <div className="font-medium text-gray-900">{supplier.supplier_name}</div>
                        <div>Contact: {supplier.contact_person ?? "None"}</div>
                        <div>Phone: {supplier.phone ?? "None"}</div>
                        <div>City: {supplier.city ?? "None"}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteSupplier(supplier.id)}
                        className="rounded bg-red-600 px-3 py-1 text-sm text-white transition hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Purchase Invoice</h2>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Supplier</span>
                <select
                  value={selectedSupplierId ?? ""}
                  onChange={(e) => setSelectedSupplierId(e.target.value === "" ? null : e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select Supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.supplier_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Invoice Number</span>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="border-t pt-4">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Product Lines</h3>

              {purchaseLines.length === 0 ? (
                <p className="mb-4 text-sm text-gray-500">No product lines added yet.</p>
              ) : (
                <div className="mb-4 space-y-3">
                  {purchaseLines.map((line, index) => (
                    <div key={index} className="rounded border border-gray-300 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Line {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleRemovePurchaseLine(index)}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Product</span>
                          <select
                            value={line.product_id ?? ""}
                            onChange={(e) =>
                              handlePurchaseLineChange(index, "product_id", e.target.value === "" ? null : e.target.value)
                            }
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="">Select Product</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Quantity</span>
                          <input
                            type="number"
                            value={line.quantity}
                            onChange={(e) => handlePurchaseLineChange(index, "quantity", e.target.value)}
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          />
                        </label>

                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Purchase Price</span>
                          <input
                            type="number"
                            value={line.purchase_price}
                            onChange={(e) => handlePurchaseLineChange(index, "purchase_price", e.target.value)}
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          />
                        </label>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Selling Price</span>
                          <input
                            type="number"
                            value={line.selling_price}
                            onChange={(e) => handlePurchaseLineChange(index, "selling_price", e.target.value)}
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          />
                        </label>

                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Batch Number</span>
                          <input
                            type="text"
                            value={line.batch_number}
                            onChange={(e) => handlePurchaseLineChange(index, "batch_number", e.target.value)}
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          />
                        </label>

                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Expiry Date</span>
                          <input
                            type="date"
                            value={line.expiry_date}
                            onChange={(e) => handlePurchaseLineChange(index, "expiry_date", e.target.value)}
                            className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={handleAddPurchaseLine}
                className="mb-4 rounded border border-blue-600 px-4 py-2 text-sm text-blue-600 transition hover:bg-blue-50"
              >
                + Add Product Line
              </button>
            </div>

            <button
              type="button"
              onClick={handleCreatePurchaseInvoice}
              disabled={invoiceLoading}
              className="w-full rounded bg-green-600 px-4 py-2 text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
            >
              {invoiceLoading ? "Creating..." : "Save Purchase Invoice"}
            </button>
          </div>

          {invoiceMessage && <p className="mt-4 text-sm text-green-700">{invoiceMessage}</p>}
          {invoiceError && <p className="mt-4 text-sm text-red-700">{invoiceError}</p>}
          {newPurchaseExpenseReminder && (
            <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-950">
                Did you pay any transport, fuel, vehicle rent, loading, travel, or other expense to bring this stock to your warehouse?
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Invoice: {newPurchaseExpenseReminder.invoiceNumber}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() =>
                    handleAddPurchaseExpense(
                      newPurchaseExpenseReminder.id,
                      newPurchaseExpenseReminder.supplierId
                    )
                  }
                  className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                >
                  Add Purchase Expense
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updatePurchaseExpenseStatus(
                      newPurchaseExpenseReminder.id,
                      "no_additional_expense"
                    )
                  }
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  No Additional Expense
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updatePurchaseExpenseStatus(newPurchaseExpenseReminder.id, "review_later")
                  }
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Review Later
                </button>
              </div>
            </div>
          )}
          {purchaseExpenseStatusMessage && (
            <p className="mt-4 text-sm text-green-700">{purchaseExpenseStatusMessage}</p>
          )}
        </section>

        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Purchase History</h2>
          {purchaseLoading ? (
            <p className="text-sm text-gray-600">Loading purchase history...</p>
          ) : purchaseTransactions.length === 0 ? (
            <p className="text-sm text-gray-600">No purchase invoices found.</p>
          ) : (
            <ul className="space-y-3">
              {purchaseTransactions.map((transaction) => {
                const supplier = suppliers.find((s) => s.id === transaction.supplier_id);
                const date = new Date(transaction.created_at).toLocaleDateString();
                const expenseReviewStatus = transaction.expense_review_status ?? "pending";
                const expenseReviewLabel =
                  expenseReviewStatus === "expenses_added"
                    ? "Expenses added"
                    : expenseReviewStatus === "no_additional_expense"
                      ? "No additional expense"
                      : expenseReviewStatus === "review_later"
                        ? "Review later"
                        : "Expense review pending";
                const lineItems = purchaseItems.filter(
                  (item) => item.purchase_transaction_id === transaction.id
                );
                const linkedPurchaseExpenses = expenses.filter(
                  (expense) => expense.purchase_transaction_id === transaction.id
                );
                const purchaseValue = lineItems.reduce(
                  (sum, item) =>
                    sum + Number(item.quantity || 0) * Number(item.purchase_price || 0),
                  0
                );
                const linkedExpenseTotal = linkedPurchaseExpenses.reduce(
                  (sum, expense) => sum + Number(expense.amount || 0),
                  0
                );
                const landedInvoiceCost = purchaseValue + linkedExpenseTotal;
                const totalPurchasedQuantity = lineItems.reduce(
                  (sum, item) => sum + Number(item.quantity || 0),
                  0
                );
                const distinctProductIds = Array.from(
                  new Set(lineItems.map((item) => String(item.product_id ?? "")))
                ).filter(Boolean);
                const distinctUnitTypes = Array.from(
                  new Set(
                    lineItems
                      .map((item) => {
                        const product = products.find(
                          (p) => String(p.id) === String(item.product_id)
                        );
                        return product?.unit_type ?? null;
                      })
                      .filter(Boolean)
                  )
                );
                const quantityUnitLabel =
                  distinctUnitTypes.length === 1 ? distinctUnitTypes[0] : "units";
                const averageLandedCost =
                  totalPurchasedQuantity > 0 ? landedInvoiceCost / totalPurchasedQuantity : null;
                const averageLandedCostLabel =
                  distinctProductIds.length === 1
                    ? `Average landed cost per ${quantityUnitLabel}`
                    : "Blended average across this invoice";

                return (
                  <li
                    key={transaction.id}
                    className="rounded border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700"
                  >
                    <div className="mb-3 grid gap-2 sm:grid-cols-4">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Invoice</div>
                        <div className="font-medium text-gray-900">{transaction.invoice_number}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Supplier</div>
                        <div>{supplier?.supplier_name ?? "Unknown"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Date</div>
                        <div className="text-gray-500">{date}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Expense Review</div>
                        <span className="inline-flex rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                          {expenseReviewLabel}
                        </span>
                      </div>
                    </div>

                    <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                      {(expenseReviewStatus === "pending" || expenseReviewStatus === "review_later") && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleAddPurchaseExpense(transaction.id, transaction.supplier_id)}
                            className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700"
                          >
                            Add Purchase Expense
                          </button>
                          <button
                            type="button"
                            onClick={() => updatePurchaseExpenseStatus(transaction.id, "no_additional_expense")}
                            className="rounded border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            No Additional Expense
                          </button>
                        </>
                      )}
                      {expenseReviewStatus === "expenses_added" && (
                        <button
                          type="button"
                          onClick={() => handleAddPurchaseExpense(transaction.id, transaction.supplier_id)}
                          className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700"
                        >
                          Add Another Expense
                        </button>
                      )}
                      {expenseReviewStatus === "no_additional_expense" && (
                        <button
                          type="button"
                          onClick={() => handleAddPurchaseExpense(transaction.id, transaction.supplier_id)}
                          className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700"
                        >
                          Add Expense
                        </button>
                      )}
                    </div>

                    <div className="mb-3 rounded border border-blue-100 bg-blue-50 p-3">
                      <h3 className="mb-2 text-sm font-medium text-blue-950">Cost Summary</h3>
                      <div className="grid gap-2 text-xs text-blue-950 sm:grid-cols-2 lg:grid-cols-5">
                        <div>
                          <div className="uppercase tracking-wide text-blue-700">Purchase Value</div>
                          <div className="font-medium">{pkrFormatter.format(purchaseValue)}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wide text-blue-700">Linked Expenses</div>
                          <div className="font-medium">{pkrFormatter.format(linkedExpenseTotal)}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wide text-blue-700">Landed Invoice Cost</div>
                          <div className="font-medium">{pkrFormatter.format(landedInvoiceCost)}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wide text-blue-700">Total Purchased Quantity</div>
                          <div className="font-medium">
                            {totalPurchasedQuantity} {quantityUnitLabel}
                          </div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wide text-blue-700">{averageLandedCostLabel}</div>
                          <div className="font-medium">
                            {averageLandedCost === null ? "-" : pkrFormatter.format(averageLandedCost)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3">
                      <h3 className="mb-2 text-sm font-medium text-gray-900">Linked Purchase Expenses</h3>
                      {linkedPurchaseExpenses.length === 0 ? (
                        <p className="text-xs text-gray-500">No purchase-linked expenses recorded.</p>
                      ) : (
                        <ul className="space-y-2">
                          {linkedPurchaseExpenses.map((expense) => {
                            const expenseDate = expense.created_at
                              ? new Date(expense.created_at).toLocaleDateString()
                              : "No date";
                            return (
                              <li
                                key={expense.id}
                                className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
                              >
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <div className="font-medium text-gray-900">{expense.expense_type}</div>
                                    <div className="text-gray-500">Date: {expenseDate}</div>
                                  </div>
                                  <div className="font-medium text-gray-900">
                                    {pkrFormatter.format(Number(expense.amount || 0))}
                                  </div>
                                </div>
                                {expense.notes && <div className="mt-1">Notes: {expense.notes}</div>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {lineItems.length === 0 ? (
                      <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                        No purchase lines recorded for this invoice.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {lineItems.map((item, index) => {
                          const product = products.find((p) => String(p.id) === String(item.product_id));
                          const lineTotal = Number(item.quantity || 0) * Number(item.purchase_price || 0);
                          return (
                            <div
                              key={item.id ?? index}
                              className="rounded border border-gray-200 bg-gray-50 p-3"
                            >
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-gray-500">Product</div>
                                  <div className="font-medium text-gray-900">{product?.name ?? "Unknown"}</div>
                                </div>
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-gray-500">Quantity</div>
                                  <div>{item.quantity}</div>
                                </div>
                              </div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-gray-500">Purchase Price</div>
                                  <div>{item.purchase_price}</div>
                                </div>
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-gray-500">Selling Price</div>
                                  <div>{item.selling_price ?? "-"}</div>
                                </div>
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-gray-500">Line Total</div>
                                  <div>{lineTotal}</div>
                                </div>
                              </div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-gray-500">Batch Number</div>
                                  <div>{item.batch_number ?? "-"}</div>
                                </div>
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-gray-500">Expiry Date</div>
                                  <div>{item.expiry_date ?? "-"}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {message && <p className="mt-4 text-sm text-green-700">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}
