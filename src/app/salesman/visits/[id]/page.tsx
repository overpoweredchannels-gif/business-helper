"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  Loader2, MapPin, Navigation, FileText, CheckCircle2, AlertCircle, ArrowLeft,
  Plus, Trash2, Search, Camera, Image as ImageIcon,
} from "lucide-react";

interface Visit {
  id: string;
  employee_id: string;
  customer_id: string;
  route_id?: string | null;
  stop_id?: string | null;
  visit_status: string;
  started_at?: string | null;
  ended_at?: string | null;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  images?: Array<{ url: string; caption?: string | null; uploaded_at?: string }> | null;
  customers?: {
    customer_name?: string;
    shop_name?: string;
    phone?: string;
    customer_lat?: number;
    customer_lng?: number;
  };
}

interface Product {
  id: string;
  name: string;
  sku?: string;
  unit_type?: string;
  current_stock: number;
  default_selling_price: number;
}

interface DraftItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  stock: number;
}

interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

function getPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(`Location error: ${err.message}`)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}

export default function VisitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const visitId = params.id;

  const [visit, setVisit] = useState<Visit | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  // Notes
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");

  // Draft sale
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);

  // Photos
  const [photoLoading, setPhotoLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadVisit = useCallback(async (empId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch(`/api/visits/${visitId}`);
      const data = await res.json();
      if (data.ok && data.visit) {
        setVisit(data.visit);
        setNotes(data.visit.notes ?? "");
        setSavedNotes(data.visit.notes ?? "");
      } else {
        setError(data.error || "Visit not found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  const loadProducts = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/products/list?limit=1000");
      const data = await res.json();
      if (data.ok) setProducts(data.products ?? []);
    } catch {
      // products are optional; ignore
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await authorizedFetch("/api/identity/staff/me");
        const data = await res.json();
        if (data.ok && data.me?.employee) setEmployeeId(data.me.employee.id);
        loadVisit(data.me?.employee?.id);
      } catch {
        setError("Could not load your profile.");
        setLoading(false);
      }
    })();
  }, [loadVisit]);

  useEffect(() => {
    if (visit?.visit_status === "in_progress") loadProducts();
  }, [visit?.visit_status, loadProducts]);

  const startVisit = async () => {
    setActionLoading(true);
    setError(null);
    setGpsMessage("Getting your location...");
    try {
      const pos = await getPosition();
      const res = await authorizedFetch("/api/visits/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          customerId: visit?.customer_id,
          routeId: visit?.route_id ?? undefined,
          stopId: visit?.stop_id ?? undefined,
          latitude: pos.latitude,
          longitude: pos.longitude,
          accuracy: pos.accuracy,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to start visit");
      setSuccess("Visit started. You can now add notes.");
      await loadVisit(employeeId!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start visit");
    } finally {
      setActionLoading(false);
      setGpsMessage(null);
    }
  };

  const saveNotes = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/visits/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId, notes }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save notes");
      setSavedNotes(notes);
      setSuccess("Notes saved.");
      await loadVisit(employeeId!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setActionLoading(false);
    }
  };

  const finishVisit = async () => {
    setActionLoading(true);
    setError(null);
    setGpsMessage("Verifying your location...");
    try {
      const pos = await getPosition();
      const createDraftSale = items.length > 0;
      const body: any = {
        visitId,
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy,
      };
      if (createDraftSale) {
        body.createDraftSale = true;
        body.draftSaleData = {
          customerId: visit?.customer_id,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
        };
      }
      const res = await authorizedFetch("/api/visits/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to finish visit");
      const draftCreated = createDraftSale && Boolean(data?.visit?.draftSale);
      if (createDraftSale && !draftCreated) {
        setError("Visit finished, but the draft sale could not be created. Please contact your manager.");
        setItems([]);
        await loadVisit(employeeId!);
        return;
      }
      setSuccess(draftCreated ? "Visit finished. Draft sale created and sent for approval." : "Visit finished.");
      setItems([]);
      await loadVisit(employeeId!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finish visit");
    } finally {
      setActionLoading(false);
      setGpsMessage(null);
    }
  };

  const addItem = (p: Product) => {
    const existing = items.find((i) => i.productId === p.id);
    if (existing) {
      setItems(items.map((i) => (i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      setItems([...items, { productId: p.id, productName: p.name, quantity: 1, unitPrice: Number(p.default_selling_price ?? 0), stock: Number(p.current_stock ?? 0) }]);
    }
  };

  const uploadPhoto = async (file: File) => {
    setPhotoLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("visitId", visitId);
      formData.append("photo", file);
      const res = await authorizedFetch("/api/visits/photos", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to upload photo");
      setSuccess("Photo uploaded.");
      await loadVisit(employeeId!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setPhotoLoading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadPhoto(file);
    e.target.value = "";
  };

  const updateQty = (id: string, qty: number) => {
    setItems(items.map((i) => (i.productId === id ? { ...i, quantity: Math.max(1, qty) } : i)));
  };

  const removeItem = (id: string) => {
    setItems(items.filter((i) => i.productId !== id));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading visit...</p>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="grid gap-4">
        <div className="rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">{error ?? "Visit not found"}</div>
        <button onClick={() => router.push("/salesman/visits")} className="inline-flex items-center gap-2 text-sm text-primary">
          <ArrowLeft className="size-4" /> Back to visits
        </button>
      </div>
    );
  }

  const customer = visit.customers;
  const isInProgress = visit.visit_status === "in_progress";
  const isCompleted = visit.visit_status === "completed";
  const isPlanned = visit.visit_status === "planned";

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/salesman/visits")} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back
        </button>
        <StatusBadge status={visit.visit_status} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h1 className="font-heading font-bold text-2xl text-foreground">{customer?.shop_name || customer?.customer_name || "Customer"}</h1>
        {customer?.phone && <p className="text-sm text-body mt-1">{customer.phone}</p>}
        {visit.started_at && (
          <p className="text-xs text-light-text mt-2">
            Started {new Date(visit.started_at).toLocaleString()}
            {visit.ended_at ? ` · Ended ${new Date(visit.ended_at).toLocaleString()}` : ""}
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
          <CheckCircle2 className="size-4 mt-0.5 shrink-0" /> {success}
        </div>
      )}
      {gpsMessage && (
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm text-body">
          <Navigation className="size-4 text-primary animate-pulse" /> {gpsMessage}
        </div>
      )}

      {isPlanned && (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <MapPin className="size-8 text-primary mx-auto mb-3" />
          <h2 className="font-semibold text-foreground mb-1">Start this visit</h2>
          <p className="text-sm text-body mb-5">We will verify your GPS location is near the customer (within 100m).</p>
          <button
            onClick={startVisit}
            disabled={actionLoading || !employeeId}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-8 text-primary-foreground font-medium disabled:opacity-50"
          >
            {actionLoading ? <Loader2 className="size-4 animate-spin" /> : <Navigation className="size-4" />}
            {actionLoading ? "Starting..." : "Start visit"}
          </button>
        </div>
      )}

      {isInProgress && (
        <>
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-semibold text-foreground mb-3">Visit notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Write notes about this visit..."
              className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-light-text">{savedNotes ? "Last saved: notes present" : "No saved notes"}</span>
              <button
                onClick={saveNotes}
                disabled={actionLoading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <FileText className="size-4" /> {actionLoading ? "Saving..." : "Save notes"}
              </button>
            </div>
          </div>

          {/* Visit photos */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-semibold text-foreground mb-1">Visit photos</h2>
            <p className="text-sm text-body mb-4">Capture proof of visit or product photos.</p>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={photoLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {photoLoading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              {photoLoading ? "Uploading..." : "Take / choose photo"}
            </button>

            {visit.images && visit.images.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {visit.images.map((img, i) => (
                  <a key={i} href={img.url} target="_blank" rel="noopener noreferrer" className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                    <img src={img.url} alt={img.caption || "Visit photo"} className="size-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <ImageIcon className="size-5 text-white" />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Draft sale builder */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-semibold text-foreground mb-1">Record a sale (draft)</h2>
            <p className="text-sm text-body mb-4">Add products to create a draft sale. The manager approves it and it becomes an invoice.</p>

            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 pl-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {productSearch.trim() && (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border mb-4">
                {products
                  .filter((p) => (p.name + " " + (p.sku ?? "")).toLowerCase().includes(productSearch.toLowerCase()))
                  .slice(0, 15)
                  .map((p) => (
                    <button key={p.id} onClick={() => addItem(p)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/40 text-left">
                      <div>
                        <div className="text-foreground font-medium">{p.name}</div>
                        <div className="text-xs text-body">Stock: {p.current_stock} · {p.unit_type ?? ""}</div>
                      </div>
                      <div className="text-sm font-semibold text-foreground">{fmt(p.default_selling_price)}</div>
                    </button>
                  ))}
                {products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase())).length === 0 && (
                  <div className="px-4 py-3 text-sm text-body">No products found.</div>
                )}
              </div>
            )}

            {items.length > 0 && (
              <div className="rounded-lg border border-border divide-y divide-border mb-4">
                {items.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{item.productName}</div>
                      <div className="text-xs text-body">{fmt(item.unitPrice)} each</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(item.productId, item.quantity - 1)} className="size-7 rounded-md border border-border text-foreground hover:bg-muted">−</button>
                      <span className="w-8 text-center text-sm font-medium text-foreground">{item.quantity}</span>
                      <button onClick={() => updateQty(item.productId, item.quantity + 1)} className="size-7 rounded-md border border-border text-foreground hover:bg-muted">+</button>
                      <span className="w-20 text-right text-sm font-semibold text-foreground">{fmt(item.quantity * item.unitPrice)}</span>
                      <button onClick={() => removeItem(item.productId)} className="size-7 rounded-md text-destructive hover:bg-destructive/10">
                        <Trash2 className="size-4 mx-auto" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                  <span className="text-sm font-medium text-foreground">Total</span>
                  <span className="font-heading font-bold text-foreground">{fmt(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0))}</span>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-primary/30 bg-primary-light p-6">
            <h2 className="font-semibold text-foreground mb-1">Finish visit</h2>
            <p className="text-sm text-body mb-4">
              GPS will be verified near the customer{items.length > 0 ? ". Your draft sale will be sent for manager approval." : "."}
            </p>
            <button
              onClick={finishVisit}
              disabled={actionLoading}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-8 text-primary-foreground font-medium disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {actionLoading ? "Finishing..." : "Finish visit"}
            </button>
          </div>
        </>
      )}

      {isCompleted && (
        <div className="rounded-2xl border border-success/30 bg-success/10 p-6">
          <div className="flex items-center gap-2 font-semibold text-success mb-1">
            <CheckCircle2 className="size-5" /> Visit completed
          </div>
          {visit.notes && <p className="text-sm text-body mt-2">{visit.notes}</p>}
          <button
            onClick={() => router.push("/salesman/drafts?new=true")}
            className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" /> Create new draft sale
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    planned: "bg-muted text-muted-foreground",
    in_progress: "bg-primary-light text-primary",
    completed: "bg-success/10 text-success",
    missed: "bg-destructive/10 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };
  const labels: Record<string, string> = {
    planned: "Planned", in_progress: "Active", completed: "Completed", missed: "Missed", cancelled: "Cancelled",
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}