"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  aiAssistantExampleCommands,
  aiAssistantRoadmapItems,
  defaultSecurityChecks,
  deploymentManualChecklistItems,
  marketAffectedAreaOptions,
  marketCategoryOptions,
  marketConfidenceOptions,
  marketImpactDirectionOptions,
  marketImpactLevelOptions,
  marketImportQueueExampleChips,
  marketIntelligenceExampleChips,
  marketIntelligenceStatusOptions,
  mobileReadinessItems,
  mobileRoadmapItems,
  navigationItems,
  staffPermissionLabels,
  staffRoles,
  taskPriorities,
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
  taskTypeLabels,
  taskTypes,
} from "@/lib/tradeos/constants";
import {
  addDaysToDateInputValue,
  calculateDistanceMeters,
  downloadCsv,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatPKR,
  getDateOnly,
  getMonthRange,
  getUsableTimestamp,
  isDateInRange,
  toDateInputValue,
} from "@/lib/tradeos/formatters";
import type {
  AiActionDraft,
  AiActionMessage,
  AuditLog,
  Brand,
  Category,
  Customer,
  MarketAiAnalysis,
  MarketIntelligenceItem,
  MarketImportQueueItem,
  MarketNewsSource,
  NewPurchaseExpenseReminder,
  Product,
  PurchaseLine,
  PurchaseTransaction,
  SalesTransaction,
  SectionId,
  SecurityCheck,
  CurrentLocationSnapshot,
  StaffDutySession,
  StaffLocationPoint,
  StaffPermission,
  StaffPermissionKey,
  StaffProfile,
  Supplier,
  SupplierLedgerDisplayEntry,
  SupplierLedgerEntry,
  SupplierPurchasePaymentAllocation,
  Task,
  TaskSuggestion,
} from "@/lib/tradeos/types";
import { isValidUuid, normalizeOptionalUuid, safeNumber, safeTextOrNull } from "@/lib/tradeos/validators";

type TradeOsSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type TradeOsSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: TradeOsSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
};

type TradeOsSpeechRecognitionConstructor = new () => TradeOsSpeechRecognition;

type TradeOsSpeechWindow = Window & {
  SpeechRecognition?: TradeOsSpeechRecognitionConstructor;
  webkitSpeechRecognition?: TradeOsSpeechRecognitionConstructor;
};

export default function Home() {
  const [activeSection, setActiveSection] = useState<SectionId>("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [printPreviewTitle, setPrintPreviewTitle] = useState("");
  const [printPreviewHtml, setPrintPreviewHtml] = useState("");
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
  const [reorderRecommendationFilter, setReorderRecommendationFilter] = useState("all");
  const [reorderRecommendationSearch, setReorderRecommendationSearch] = useState("");
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
  const [currentOrganization, setCurrentOrganization] = useState<any | null>(null);
  const [businessSettingsName, setBusinessSettingsName] = useState("");
  const [businessSettingsPhone, setBusinessSettingsPhone] = useState("");
  const [businessSettingsAddress, setBusinessSettingsAddress] = useState("");
  const [businessSettingsCity, setBusinessSettingsCity] = useState("");
  const [businessSettingsInvoiceFooterNote, setBusinessSettingsInvoiceFooterNote] = useState("");
  const [businessSettingsDefaultPaymentTerms, setBusinessSettingsDefaultPaymentTerms] = useState("");
  const [businessSettingsLoading, setBusinessSettingsLoading] = useState(false);
  const [businessSettingsMessage, setBusinessSettingsMessage] = useState<string | null>(null);
  const [businessSettingsError, setBusinessSettingsError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [currentProfile, setCurrentProfile] = useState<any | null>(null);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskType, setTaskType] = useState("general");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskStatus, setTaskStatus] = useState("pending");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [selectedTaskCustomerId, setSelectedTaskCustomerId] = useState("");
  const [selectedTaskSupplierId, setSelectedTaskSupplierId] = useState("");
  const [selectedTaskProductId, setSelectedTaskProductId] = useState("");
  const [selectedTaskPurchaseId, setSelectedTaskPurchaseId] = useState("");
  const [selectedTaskSaleId, setSelectedTaskSaleId] = useState("");
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLogSearch, setAuditLogSearch] = useState("");
  const [auditLogEntityFilter, setAuditLogEntityFilter] = useState("all");
  const [auditLogActionFilter, setAuditLogActionFilter] = useState("all");
  const [auditLogDateFrom, setAuditLogDateFrom] = useState("");
  const [auditLogDateTo, setAuditLogDateTo] = useState("");
  const [expandedAuditLogIds, setExpandedAuditLogIds] = useState<Record<string, boolean>>({});
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([]);
  const [staffPermissions, setStaffPermissions] = useState<StaffPermission[]>([]);
  const [staffPermissionMessage, setStaffPermissionMessage] = useState<string | null>(null);
  const [staffPermissionError, setStaffPermissionError] = useState<string | null>(null);
  const [selectedStaffProfileId, setSelectedStaffProfileId] = useState("");
  const [staffProfileDrafts, setStaffProfileDrafts] = useState<
    Record<string, { display_name: string; role: string; is_active: boolean }>
  >({});
  const [staffPermissionDraft, setStaffPermissionDraft] = useState<Record<StaffPermissionKey, boolean>>(
    () =>
      staffPermissionLabels.reduce((draft, permission) => {
        draft[permission.key] = false;
        return draft;
      }, {} as Record<StaffPermissionKey, boolean>)
  );
  const [securityChecks, setSecurityChecks] = useState<SecurityCheck[]>([]);
  const [securityCheckNotes, setSecurityCheckNotes] = useState<Record<string, string>>({});
  const [securityCheckMessage, setSecurityCheckMessage] = useState<string | null>(null);
  const [securityCheckError, setSecurityCheckError] = useState<string | null>(null);
  const [deploymentChecklistState, setDeploymentChecklistState] = useState<Record<string, boolean>>({});
  const [aiActionDrafts, setAiActionDrafts] = useState<AiActionDraft[]>([]);
  const [aiCommandText, setAiCommandText] = useState("");
  const [aiAssistantMessage, setAiAssistantMessage] = useState<string | null>(null);
  const [aiAssistantError, setAiAssistantError] = useState<string | null>(null);
  const [selectedAiDraftId, setSelectedAiDraftId] = useState("");
  const [aiDraftAnswerInputs, setAiDraftAnswerInputs] = useState<Record<string, Record<string, string>>>({});
  const [aiDraftStatusFilter, setAiDraftStatusFilter] = useState("all");
  const [aiDraftActionTypeFilter, setAiDraftActionTypeFilter] = useState("all");
  const [aiDraftSearch, setAiDraftSearch] = useState("");
  const [selectedConversationDraftId, setSelectedConversationDraftId] = useState("");
  const [aiConversationMessages, setAiConversationMessages] = useState<AiActionMessage[]>([]);
  const [aiConversationInput, setAiConversationInput] = useState("");
  const [aiConversationMessage, setAiConversationMessage] = useState<string | null>(null);
  const [aiConversationError, setAiConversationError] = useState<string | null>(null);
  const [activeMissingField, setActiveMissingField] = useState("");
  const [isVoiceAnswerListening, setIsVoiceAnswerListening] = useState(false);
  const [voiceAnswerMessage, setVoiceAnswerMessage] = useState<string | null>(null);
  const [voiceAnswerError, setVoiceAnswerError] = useState<string | null>(null);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [voiceInputMessage, setVoiceInputMessage] = useState<string | null>(null);
  const [voiceInputError, setVoiceInputError] = useState<string | null>(null);
  const [voiceTranscriptPreview, setVoiceTranscriptPreview] = useState("");
  const speechRecognitionRef = useRef<TradeOsSpeechRecognition | null>(null);
  const [marketNewsSources, setMarketNewsSources] = useState<MarketNewsSource[]>([]);
  const [marketIntelligenceItems, setMarketIntelligenceItems] = useState<MarketIntelligenceItem[]>([]);
  const [marketImportQueueItems, setMarketImportQueueItems] = useState<MarketImportQueueItem[]>([]);
  const [marketAiAnalyses, setMarketAiAnalyses] = useState<MarketAiAnalysis[]>([]);
  const [marketIntelligenceMessage, setMarketIntelligenceMessage] = useState<string | null>(null);
  const [marketIntelligenceError, setMarketIntelligenceError] = useState<string | null>(null);
  const [marketImportQueueMessage, setMarketImportQueueMessage] = useState<string | null>(null);
  const [marketImportQueueError, setMarketImportQueueError] = useState<string | null>(null);
  const [marketAiAnalysisMessage, setMarketAiAnalysisMessage] = useState<string | null>(null);
  const [marketAiAnalysisError, setMarketAiAnalysisError] = useState<string | null>(null);
  const [marketAiAnalysisLoadingId, setMarketAiAnalysisLoadingId] = useState("");
  const [selectedAiAnalysisId, setSelectedAiAnalysisId] = useState("");
  const [marketIntelligenceSearch, setMarketIntelligenceSearch] = useState("");
  const [marketIntelligenceCategoryFilter, setMarketIntelligenceCategoryFilter] = useState("all");
  const [marketIntelligenceImpactFilter, setMarketIntelligenceImpactFilter] = useState("all");
  const [marketIntelligenceStatusFilter, setMarketIntelligenceStatusFilter] = useState("all");
  const [marketImportQueueSearch, setMarketImportQueueSearch] = useState("");
  const [marketImportQueueStatusFilter, setMarketImportQueueStatusFilter] = useState("all");
  const [selectedMarketImportQueueId, setSelectedMarketImportQueueId] = useState("");
  const [marketTitle, setMarketTitle] = useState("");
  const [marketSummary, setMarketSummary] = useState("");
  const [marketSourceName, setMarketSourceName] = useState("");
  const [marketSourceUrl, setMarketSourceUrl] = useState("");
  const [marketCategory, setMarketCategory] = useState("");
  const [marketRelatedProductCategory, setMarketRelatedProductCategory] = useState("");
  const [marketRelatedProductId, setMarketRelatedProductId] = useState("");
  const [marketImpactDirection, setMarketImpactDirection] = useState("");
  const [marketImpactLevel, setMarketImpactLevel] = useState("");
  const [marketConfidenceLevel, setMarketConfidenceLevel] = useState("");
  const [marketAffectedArea, setMarketAffectedArea] = useState("");
  const [marketSuggestedAction, setMarketSuggestedAction] = useState("");
  const [marketNewsDate, setMarketNewsDate] = useState(toDateInputValue(new Date()));
  const [marketStatus, setMarketStatus] = useState("active");
  const [marketNewsSourceName, setMarketNewsSourceName] = useState("");
  const [marketNewsSourceType, setMarketNewsSourceType] = useState("");
  const [marketNewsSourceUrl, setMarketNewsSourceUrl] = useState("");
  const [marketNewsSourceCountry, setMarketNewsSourceCountry] = useState("Pakistan");
  const [marketNewsSourceIsActive, setMarketNewsSourceIsActive] = useState(true);
  const [marketImportSourceName, setMarketImportSourceName] = useState("");
  const [marketImportSourceUrl, setMarketImportSourceUrl] = useState("");
  const [marketImportRawTitle, setMarketImportRawTitle] = useState("");
  const [marketImportRawSummary, setMarketImportRawSummary] = useState("");
  const [marketImportRawText, setMarketImportRawText] = useState("");
  const [marketImportSuggestedCategory, setMarketImportSuggestedCategory] = useState("");
  const [marketImportSuggestedImpactDirection, setMarketImportSuggestedImpactDirection] = useState("");
  const [marketImportSuggestedImpactLevel, setMarketImportSuggestedImpactLevel] = useState("");
  const [marketImportSuggestedConfidenceLevel, setMarketImportSuggestedConfidenceLevel] = useState("");
  const [marketImportSuggestedAffectedArea, setMarketImportSuggestedAffectedArea] = useState("");
  const [marketImportSuggestedAction, setMarketImportSuggestedAction] = useState("");
  const [marketImportNotes, setMarketImportNotes] = useState("");
  const [dutySessions, setDutySessions] = useState<StaffDutySession[]>([]);
  const [locationPoints, setLocationPoints] = useState<StaffLocationPoint[]>([]);
  const [activeDutySession, setActiveDutySession] = useState<StaffDutySession | null>(null);
  const [currentDutyLocation, setCurrentDutyLocation] = useState<CurrentLocationSnapshot | null>(null);
  const [locationTrackingMessage, setLocationTrackingMessage] = useState<string | null>(null);
  const [locationTrackingError, setLocationTrackingError] = useState<string | null>(null);
  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
  const [selectedStaffForLocation, setSelectedStaffForLocation] = useState("");
  const locationWatchIdRef = useRef<number | null>(null);
  const activeDutySessionIdRef = useRef<string | null>(null);
  const lastSavedLocationRef = useRef<{ latitude: number; longitude: number; capturedAt: number } | null>(null);

  useEffect(() => {
    checkAuthUser();
  }, []);

  useEffect(() => {
    return () => {
      if (typeof navigator !== "undefined" && locationWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current);
      }
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.onresult = null;
        speechRecognitionRef.current.onerror = null;
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.abort?.();
      }
    };
  }, []);

  useEffect(() => {
    const selectedPermission = staffPermissions.find(
      (permission) => permission.profile_id === selectedStaffProfileId
    );
    setStaffPermissionDraft(
      staffPermissionLabels.reduce((draft, permission) => {
        draft[permission.key] = Boolean(selectedPermission?.[permission.key]);
        return draft;
      }, {} as Record<StaffPermissionKey, boolean>)
    );
  }, [selectedStaffProfileId, staffPermissions]);

  const fetchExpenses = async (organizationId: string | null) => {
    if (!organizationId) {
      setExpenses([]);
      return;
    }

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

  const fetchTasks = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setTasks([]);
      return;
    }

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("organization_id", orgId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase fetch tasks error:", JSON.stringify(error, null, 2));
      return;
    }

    setTasks(data ?? []);
  };

  const fetchAuditLogs = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setAuditLogs([]);
      return;
    }

    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Supabase fetch audit logs error:", JSON.stringify(error, null, 2));
      return;
    }

    setAuditLogs(data ?? []);
  };

  const fetchAiActionDrafts = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setAiActionDrafts([]);
      return;
    }

    const { data, error } = await supabase
      .from("ai_action_drafts")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase fetch AI action drafts error:", JSON.stringify(error, null, 2));
      return;
    }

    setAiActionDrafts(data ?? []);
  };

  const fetchAiActionMessages = async (draftId?: string | null, organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    const selectedDraftId = draftId ?? selectedConversationDraftId;
    if (!orgId || !selectedDraftId) {
      setAiConversationMessages([]);
      return [];
    }

    const { data, error } = await supabase
      .from("ai_action_messages")
      .select("*")
      .eq("organization_id", orgId)
      .eq("ai_action_draft_id", selectedDraftId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Supabase fetch AI action messages error:", JSON.stringify(error, null, 2));
      return [];
    }

    const messages = data ?? [];
    setAiConversationMessages(messages);
    return messages;
  };

  const fetchMarketNewsSources = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setMarketNewsSources([]);
      return;
    }

    const { data, error } = await supabase
      .from("market_news_sources")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase fetch market news sources error:", JSON.stringify(error, null, 2));
      return;
    }

    setMarketNewsSources(data ?? []);
  };

  const fetchMarketIntelligenceItems = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setMarketIntelligenceItems([]);
      return;
    }

    const { data, error } = await supabase
      .from("market_intelligence_items")
      .select("*")
      .eq("organization_id", orgId)
      .order("news_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Supabase fetch market intelligence items error:", JSON.stringify(error, null, 2));
      return;
    }

    setMarketIntelligenceItems(data ?? []);
  };

  const fetchMarketImportQueueItems = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setMarketImportQueueItems([]);
      return;
    }

    const { data, error } = await supabase
      .from("market_import_queue")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Supabase fetch market import queue error:", JSON.stringify(error, null, 2));
      return;
    }

    setMarketImportQueueItems(data ?? []);
  };

  const fetchMarketAiAnalyses = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setMarketAiAnalyses([]);
      return;
    }

    const { data, error } = await supabase
      .from("market_ai_analyses")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Supabase fetch market AI analyses error:", JSON.stringify(error, null, 2));
      return;
    }

    setMarketAiAnalyses(data ?? []);
  };

  const fetchSecurityChecks = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setSecurityChecks([]);
      setSecurityCheckNotes({});
      return;
    }

    const { data, error } = await supabase
      .from("security_checks")
      .select("*")
      .eq("organization_id", orgId)
      .order("checked_at", { ascending: false, nullsFirst: false });

    if (error) {
      console.error("Supabase fetch security checks error:", JSON.stringify(error, null, 2));
      return;
    }

    const checks = data ?? [];
    setSecurityChecks(checks);
    setSecurityCheckNotes(
      checks.reduce((notes, check) => {
        notes[check.check_key] = check.notes ?? "";
        return notes;
      }, {} as Record<string, string>)
    );
  };

  const fetchStaffProfilesAndPermissions = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setStaffProfiles([]);
      setStaffPermissions([]);
      setSelectedStaffProfileId("");
      return;
    }

    let profilesResult = await supabase
      .from("profiles")
      .select("id, organization_id, email, role, is_active, display_name, auth_user_id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });

    if (profilesResult.error) {
      console.warn("Profile created_at ordering unavailable, retrying by email:", profilesResult.error);
      profilesResult = await supabase
        .from("profiles")
        .select("id, organization_id, email, role, is_active, display_name, auth_user_id")
        .eq("organization_id", orgId)
        .order("email", { ascending: true });
    }

    if (profilesResult.error) {
      console.error("Supabase fetch staff profiles error:", JSON.stringify(profilesResult.error, null, 2));
      return;
    }

    const { data: permissionsData, error: permissionsError } = await supabase
      .from("staff_permissions")
      .select("*")
      .eq("organization_id", orgId);

    if (permissionsError) {
      console.error("Supabase fetch staff permissions error:", JSON.stringify(permissionsError, null, 2));
      return;
    }

    const profiles = profilesResult.data ?? [];
    setStaffProfiles(profiles);
    setStaffPermissions(permissionsData ?? []);
    setStaffProfileDrafts(
      profiles.reduce((drafts, profile) => {
        drafts[profile.id] = {
          display_name: profile.display_name ?? "",
          role: profile.role ?? "staff",
          is_active: profile.is_active !== false,
        };
        return drafts;
      }, {} as Record<string, { display_name: string; role: string; is_active: boolean }>)
    );

    const nextSelectedStaffProfileId =
      selectedStaffProfileId && profiles.some((profile) => profile.id === selectedStaffProfileId)
        ? selectedStaffProfileId
        : profiles[0]?.id ?? "";
    setSelectedStaffProfileId(nextSelectedStaffProfileId);
  };

  const fetchDutySessions = async (organizationId?: string | null, profileId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setDutySessions([]);
      setActiveDutySession(null);
      activeDutySessionIdRef.current = null;
      return;
    }

    const { data, error } = await supabase
      .from("staff_duty_sessions")
      .select("*")
      .eq("organization_id", orgId)
      .order("started_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Supabase fetch staff duty sessions error:", JSON.stringify(error, null, 2));
      return;
    }

    const sessions = data ?? [];
    setDutySessions(sessions);
    const currentProfileId = profileId ?? currentProfile?.id ?? null;
    const ownActiveSession =
      sessions.find((session) => session.profile_id === currentProfileId && session.status === "on_duty") ?? null;
    setActiveDutySession(ownActiveSession);
    activeDutySessionIdRef.current = ownActiveSession?.id ?? null;
  };

  const fetchLocationPoints = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setLocationPoints([]);
      return;
    }

    const { data, error } = await supabase
      .from("staff_location_points")
      .select("*")
      .eq("organization_id", orgId)
      .order("captured_at", { ascending: false })
      .limit(300);

    if (error) {
      console.error("Supabase fetch staff location points error:", JSON.stringify(error, null, 2));
      return;
    }

    setLocationPoints(data ?? []);
  };

  const populateBusinessSettings = (organization: any | null) => {
    setCurrentOrganization(organization);
    setBusinessSettingsName(organization?.name ?? "");
    setBusinessSettingsPhone(organization?.phone ?? "");
    setBusinessSettingsAddress(organization?.address ?? "");
    setBusinessSettingsCity(organization?.city ?? "");
    setBusinessSettingsInvoiceFooterNote(organization?.invoice_footer_note ?? "");
    setBusinessSettingsDefaultPaymentTerms(organization?.default_payment_terms ?? "");
  };

  const fetchCurrentOrganization = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      populateBusinessSettings(null);
      return;
    }

    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, phone, address, city, invoice_footer_note, default_payment_terms")
      .eq("id", orgId)
      .maybeSingle();

    if (error) {
      console.error("Supabase fetch organization error:", JSON.stringify(error, null, 2));
      setBusinessSettingsError(`Failed to load business settings: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    populateBusinessSettings(data);
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

    let resolvedProfile = profile;
    if (!profile.auth_user_id && profile.id && profile.organization_id) {
      const { error: authLinkError } = await supabase
        .from("profiles")
        .update({ auth_user_id: userId })
        .eq("id", profile.id)
        .eq("organization_id", profile.organization_id)
        .is("auth_user_id", null);

      if (authLinkError) {
        console.error("Profile auth_user_id link error:", JSON.stringify(authLinkError, null, 2));
      } else {
        resolvedProfile = { ...profile, auth_user_id: userId };
        console.log("Profile auth_user_id linked successfully:", {
          profileId: profile.id,
          organizationId: profile.organization_id,
        });
      }
    }

    console.log("Profile loaded successfully:", { userId, organizationId: resolvedProfile.organization_id });
    setAuthError(null);
    setCurrentProfile(resolvedProfile);
    setCurrentOrganizationId(resolvedProfile.organization_id);
    fetchCurrentOrganization(resolvedProfile.organization_id);
    fetchBrands(resolvedProfile.organization_id);
    fetchCategories(resolvedProfile.organization_id);
    fetchProducts(resolvedProfile.organization_id);
    fetchCustomers(resolvedProfile.organization_id);
    fetchSuppliers(resolvedProfile.organization_id);
    fetchPurchaseTransactions(resolvedProfile.organization_id);
    fetchSalesTransactions(resolvedProfile.organization_id);
    fetchCustomerPayments(resolvedProfile.organization_id);
    fetchCustomerPaymentAllocations(resolvedProfile.organization_id);
    fetchSupplierPayments(resolvedProfile.organization_id);
    fetchSupplierPaymentAllocations(resolvedProfile.organization_id);
    fetchExpenses(resolvedProfile.organization_id);
    fetchTasks(resolvedProfile.organization_id);
    fetchAuditLogs(resolvedProfile.organization_id);
    fetchAiActionDrafts(resolvedProfile.organization_id);
    fetchMarketNewsSources(resolvedProfile.organization_id);
    fetchMarketIntelligenceItems(resolvedProfile.organization_id);
    fetchMarketImportQueueItems(resolvedProfile.organization_id);
    fetchMarketAiAnalyses(resolvedProfile.organization_id);
    fetchStaffProfilesAndPermissions(resolvedProfile.organization_id);
    fetchSecurityChecks(resolvedProfile.organization_id);
    fetchDutySessions(resolvedProfile.organization_id, resolvedProfile.id);
    fetchLocationPoints(resolvedProfile.organization_id);
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

  const requireOrganization = (actionName: string) => {
    if (!currentOrganizationId) {
      const message = `Organization not loaded. Cannot ${actionName}. Please login again.`;
      console.error(message);
      setAuthError(message);
      return false;
    }
    return true;
  };

  const fetchBrands = async (organizationId?: string | null) => {
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

  const handleSupplierPaymentSupplierChange = (supplierId: string) => {
    setSelectedSupplierPaymentId(supplierId === "" ? null : supplierId);
    setSupplierPaymentAllocationsByInvoice({});
  };

  const handleSupplierPaymentAmountChange = (amount: string) => {
    setSupplierPaymentAmount(amount);
    setSupplierPaymentAllocationsByInvoice({});
  };

  const handleSupplierPaymentAllocationChange = (invoiceId: string, amount: string) => {
    setSupplierPaymentAllocationsByInvoice((current) => ({
      ...current,
      [invoiceId]: amount,
    }));
  };

  const handleAutoAllocateSupplierPayment = () => {
    const paymentAmount = Number(supplierPaymentAmount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setSupplierPaymentError("Please enter a valid payment amount before auto allocating.");
      setSupplierPaymentMessage(null);
      return;
    }

    let remainingPaymentAmount = paymentAmount;
    const nextAllocations: Record<string, string> = {};

    unpaidPurchaseInvoicesForSelectedPaymentSupplier.forEach((invoice) => {
      if (remainingPaymentAmount <= 0) return;
      const allocationAmount = Math.min(remainingPaymentAmount, invoice.remainingPayableAmount);
      if (allocationAmount > 0) {
        nextAllocations[invoice.transaction.id] = String(allocationAmount);
        remainingPaymentAmount -= allocationAmount;
      }
    });

    setSupplierPaymentError(null);
    setSupplierPaymentAllocationsByInvoice(nextAllocations);
  };

  const createAuditLog = async (params: {
    action: string;
    entity_type: string;
    entity_id?: string | number | null;
    entity_label?: string | null;
    description?: string | null;
    old_values?: Record<string, unknown> | null;
    new_values?: Record<string, unknown> | null;
  }) => {
    if (!currentOrganizationId) {
      console.error("Organization not loaded. Cannot create audit log.");
      return;
    }

    const payload = {
      organization_id: currentOrganizationId,
      actor_profile_id: currentProfile?.id ?? null,
      actor_email: currentProfile?.email ?? currentUser?.email ?? null,
      action: params.action,
      entity_type: params.entity_type,
      entity_id: params.entity_id == null ? null : String(params.entity_id),
      entity_label: params.entity_label ?? null,
      description: params.description ?? null,
      old_values: params.old_values ?? null,
      new_values: params.new_values ?? null,
    };

    try {
      const { error } = await supabase.from("audit_logs").insert(payload);

      if (error) {
        console.error("Supabase audit log insert error:", JSON.stringify(error, null, 2));
        return;
      }

      await fetchAuditLogs(currentOrganizationId);
    } catch (err) {
      console.error("Unexpected audit log insert error:", err);
    }
  };

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
  const aiRequiredFields: Record<string, string[]> = {
    create_task: ["title"],
    create_purchase_draft: ["supplier_id", "product_id", "quantity", "purchase_price", "selling_price"],
    create_sale_draft: ["customer_id", "product_id", "quantity", "selling_price", "payment_type"],
    create_expense_draft: ["amount", "expense_type"],
  };
  const aiQuestionLabels: Record<string, string> = {
    supplier_id: "Which supplier?",
    customer_id: "Which customer?",
    product_id: "Which product?",
    quantity: "How many units/cartons?",
    purchase_price: "What is the purchase price?",
    selling_price: "What is the selling price?",
    payment_type: "Is this cash or credit?",
    title: "What task should be created?",
    amount: "What is the expense amount?",
    expense_type: "What is the expense type?",
  };
  const aiConversationQuestionOrder: Record<string, string[]> = {
    create_purchase_draft: ["supplier_id", "product_id", "quantity", "purchase_price", "selling_price"],
    create_sale_draft: ["customer_id", "product_id", "quantity", "selling_price", "payment_type"],
    create_expense_draft: ["amount", "expense_type"],
    create_task: ["title"],
  };
  const aiConversationQuestionText: Record<string, string> = {
    supplier_id: "Which supplier?",
    customer_id: "Which customer?",
    product_id: "Which product?",
    quantity: "How many cartons/units?",
    purchase_price: "What is the purchase price?",
    selling_price: "What is the selling price?",
    payment_type: "Is this cash or credit?",
    amount: "What is the expense amount?",
    expense_type: "What type of expense is this?",
    title: "What task should be created?",
  };
  const getNextMissingField = (actionType: string, missingFields: string[]) => {
    const preferredOrder = aiConversationQuestionOrder[actionType] ?? [];
    return preferredOrder.find((field) => missingFields.includes(field)) ?? missingFields[0] ?? "";
  };
  const getAiDraftMissingFields = (draft: AiActionDraft) =>
    Array.isArray(draft.missing_fields) ? draft.missing_fields.filter(Boolean) : [];
  const getParsedText = (data: Record<string, unknown>, field: string) => {
    const value = data[field];
    return typeof value === "string" && value.trim() ? value.trim() : "";
  };
  const getParsedNumber = (data: Record<string, unknown>, field: string) => {
    const value = Number(data[field]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const matchTextEntity = <T extends { id: string | number }>(
    command: string,
    items: T[],
    getLabels: (item: T) => Array<string | null | undefined>
  ) => {
    const normalizedCommand = command.toLowerCase();
    return (
      items.find((item) =>
        getLabels(item).some((label) => {
          const normalizedLabel = String(label ?? "").trim().toLowerCase();
          return normalizedLabel.length >= 3 && normalizedCommand.includes(normalizedLabel);
        })
      ) ?? null
    );
  };
  const extractCommandNumbers = (command: string) =>
    Array.from(command.matchAll(/\b\d+(?:\.\d+)?\b/g)).map((match) => Number(match[0]));
  const productSizePattern = /^\s*(ml|milliliter|millilitre|l|liter|litre|g|gram|kg|kilo)\b/i;
  const isProductSizeNumber = (command: string, matchIndex: number, matchLength: number) =>
    productSizePattern.test(command.slice(matchIndex + matchLength));
  const extractQuantityFromText = (text: string) => {
    const quantityMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(carton|cartons|box|boxes|piece|pieces|pcs|unit|units)\b/i);
    return quantityMatch ? Number(quantityMatch[1]) : null;
  };
  const extractFirstNonSizeNumber = (text: string) => {
    for (const match of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
      if (!isProductSizeNumber(text, match.index ?? 0, match[0].length)) {
        return Number(match[0]);
      }
    }
    return null;
  };
  const extractPriceFromText = (text: string, field?: "purchase_price" | "selling_price") => {
    const lowerText = text.toLowerCase();
    const specificPattern =
      field === "purchase_price"
        ? /(?:purchase price|purchase rate|cost price|cost|buying price|buy price|price|rate|at)\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)/i
        : field === "selling_price"
          ? /(?:selling price|sale price|sell price|price|rate|at)\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)/i
          : /(?:price|rate|at)\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)/i;
    const specificMatch = lowerText.match(specificPattern);
    if (specificMatch) return Number(specificMatch[1]);
    return extractFirstNonSizeNumber(text);
  };
  const tokenizeSearchText = (text: string) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
  const matchProductFromText = (text: string) => {
    const tokens = tokenizeSearchText(text);
    if (tokens.length === 0) return null;
    const scoredProducts = products
      .map((product) => {
        const productName = String(product.name ?? "").toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (productName.includes(token) ? 1 : 0), 0);
        return { product, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)));
    return scoredProducts[0]?.product ?? null;
  };
  const expenseActionKeywords = /\b(expense|transport|delivery|fuel|vehicle|rent|loading|unloading|salary|electricity|food|travel|maintenance)\b/;
  const detectAiExpenseType = (command: string) => {
    if (command.includes("transport")) return "Purchase Transport";
    if (command.includes("delivery")) return "Sales Delivery";
    if (command.includes("fuel")) return "Fuel";
    if (command.includes("vehicle")) return "Vehicle Rent";
    if (command.includes("loading") || command.includes("unloading")) return "Loading/Unloading";
    if (command.includes("salary")) return "Salary";
    if (command.includes("electricity")) return "Electricity";
    if (command.includes("rent")) return "Shop/Warehouse Rent";
    if (command.includes("food") || command.includes("travel")) return "Food/Travel";
    if (command.includes("maintenance")) return "Maintenance";
    if (command.includes("other")) return "Other";
    return null;
  };
  const generateAiInvoiceNumber = (prefix: string) => {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    return `${prefix}-${timestamp}`;
  };
  const getLatestPurchasePriceSnapshotForProduct = (productId: string | number) => {
    const latestPurchaseItem = purchaseItems
      .filter(
        (item) =>
          String(item.product_id) === String(productId) &&
          Number.isFinite(Number(item.purchase_price)) &&
          Number(item.purchase_price) > 0
      )
      .sort((a, b) => {
        const aTransaction = purchaseTransactions.find((tx) => tx.id === a.purchase_transaction_id);
        const bTransaction = purchaseTransactions.find((tx) => tx.id === b.purchase_transaction_id);
        return new Date(bTransaction?.created_at ?? 0).getTime() - new Date(aTransaction?.created_at ?? 0).getTime();
      })[0];
    const product = products.find((item) => String(item.id) === String(productId));
    const latestPurchasePrice = Number(latestPurchaseItem?.purchase_price);
    const productLastPurchasePrice = Number(product?.last_purchase_price);
    return Number.isFinite(latestPurchasePrice) && latestPurchasePrice > 0
      ? latestPurchasePrice
      : Number.isFinite(productLastPurchasePrice) && productLastPurchasePrice > 0
        ? productLastPurchasePrice
        : null;
  };
  const getAvailableStockForProduct = (productId: string | number) => {
    const purchasedQty = (purchaseItems ?? [])
      .filter((item) => String(item.product_id) === String(productId))
      .reduce((sum, item) => sum + safeNumber(item.quantity), 0);
    const soldQty = (salesItems ?? [])
      .filter((item) => String(item.product_id) === String(productId))
      .reduce((sum, item) => sum + safeNumber(item.quantity), 0);
    return purchasedQty - soldQty;
  };
  const evaluateAiDraftData = (actionType: string, parsedData: Record<string, unknown>) => {
    const product = products.find((item) => String(item.id) === String(parsedData.product_id));
    const supplier = suppliers.find((item) => String(item.id) === String(parsedData.supplier_id));
    const customer = customers.find((item) => String(item.id) === String(parsedData.customer_id));
    const linkedPurchase = purchaseTransactions.find((item) => String(item.id) === String(parsedData.purchase_transaction_id));
    const linkedSale = salesTransactions.find((item) => String(item.id) === String(parsedData.sales_transaction_id));
    const quantity = getParsedNumber(parsedData, "quantity");
    const purchasePrice = getParsedNumber(parsedData, "purchase_price");
    const sellingPrice = getParsedNumber(parsedData, "selling_price");
    const amount = getParsedNumber(parsedData, "amount");
    const paymentType = getParsedText(parsedData, "payment_type");
    const expenseType = getParsedText(parsedData, "expense_type");
    const normalizedData = {
      ...parsedData,
      product_name: product?.name ?? parsedData.product_name ?? null,
      supplier_name: supplier?.supplier_name ?? parsedData.supplier_name ?? null,
      customer_name: customer?.customer_name ?? parsedData.customer_name ?? null,
      purchase_invoice_number: linkedPurchase?.invoice_number ?? parsedData.purchase_invoice_number ?? null,
      sales_invoice_number: linkedSale?.invoice_number ?? parsedData.sales_invoice_number ?? null,
    };
    const requiredFields = aiRequiredFields[actionType] ?? ["supported_action_type"];
    const missingFields = requiredFields.filter((field) => {
      if (field === "supplier_id") return !supplier;
      if (field === "customer_id") return !customer;
      if (field === "product_id") return !product;
      if (field === "quantity") return !quantity;
      if (field === "purchase_price") return !purchasePrice;
      if (field === "selling_price") return !sellingPrice;
      if (field === "payment_type") return paymentType !== "cash" && paymentType !== "credit";
      if (field === "amount") return !amount;
      if (field === "title") return !getParsedText(normalizedData, "title");
      if (field === "expense_type") return !expenseType || !expenseTypes.includes(expenseType);
      return true;
    });
    const followUpQuestions = missingFields.map((field) => ({
      field,
      question: aiQuestionLabels[field] ?? `Provide ${field}`,
      input_type: ["quantity", "purchase_price", "selling_price", "amount"].includes(field) ? "number" : "text",
    }));
    const readyToExecute = missingFields.length === 0 && actionType !== "unknown";
    let confirmationSummary = "Command could not be matched to a supported draft action.";
    let executionPreview: Record<string, unknown> = { note: confirmationSummary };

    if (actionType === "create_task") {
      const title = getParsedText(normalizedData, "title");
      confirmationSummary = `Prepare task: ${title || "Task title needed"}`;
      executionPreview = {
        title,
        priority: "medium",
        status: "pending",
      };
    } else if (actionType === "create_purchase_draft") {
      const total = (quantity ?? 0) * (purchasePrice ?? 0);
      confirmationSummary = `Prepare purchase draft for ${product?.name ?? "unknown product"} from ${supplier?.supplier_name ?? "unknown supplier"}.`;
      executionPreview = {
        supplier: supplier?.supplier_name ?? null,
        product: product?.name ?? null,
        quantity,
        purchase_price: purchasePrice,
        selling_price: sellingPrice,
        estimated_total_purchase_value: total,
        note: "This will create a purchase invoice and purchase item.",
      };
    } else if (actionType === "create_sale_draft") {
      const availableStock = product ? getAvailableStockForProduct(product.id) : null;
      const total = (quantity ?? 0) * (sellingPrice ?? 0);
      confirmationSummary = `Prepare sale draft for ${customer?.customer_name ?? "unknown customer"} with ${product?.name ?? "unknown product"}.`;
      executionPreview = {
        customer: customer?.customer_name ?? null,
        product: product?.name ?? null,
        quantity,
        selling_price: sellingPrice,
        estimated_sale_total: total,
        payment_type: paymentType || null,
        available_stock: availableStock,
        stock_warning:
          availableStock !== null && quantity !== null && availableStock < quantity
            ? `Available stock is ${availableStock}, below requested quantity ${quantity}.`
            : null,
        note: "This will create a sales invoice and sales item.",
      };
    } else if (actionType === "create_expense_draft") {
      confirmationSummary = `Prepare expense draft for ${expenseType || "unknown expense type"} amount ${formatPKR(amount)}.`;
      executionPreview = {
        expense_type: expenseType || null,
        amount,
        notes: getParsedText(normalizedData, "notes") || null,
        linked_supplier: supplier?.supplier_name ?? null,
        linked_customer: customer?.customer_name ?? null,
        linked_purchase_invoice: linkedPurchase?.invoice_number ?? null,
        linked_sales_invoice: linkedSale?.invoice_number ?? null,
        note: "This will create an expense record.",
      };
    }

    return {
      parsedData: normalizedData,
      missingFields,
      followUpQuestions,
      readyToExecute,
      confirmationSummary,
      executionPreview,
      related_customer_id: customer?.id ?? null,
      related_supplier_id: supplier?.id ?? null,
      related_product_id: product?.id ?? null,
    };
  };
  const parseAiCommand = (command: string) => {
    const trimmedCommand = command.trim();
    const lowerCommand = trimmedCommand.toLowerCase();
    const matchedProduct = matchProductFromText(trimmedCommand) ?? matchTextEntity(trimmedCommand, products, (product) => [product.name]);
    const matchedCustomer = matchTextEntity(trimmedCommand, customers, (customer) => [
      customer.customer_name,
      customer.shop_name,
    ]);
    const matchedSupplier = matchTextEntity(trimmedCommand, suppliers, (supplier) => [
      supplier.supplier_name,
      supplier.contact_person,
    ]);
    const purchasePriceMatch = lowerCommand.match(/purchase price\s+(\d+(?:\.\d+)?)/);
    const sellingPriceMatch = lowerCommand.match(/selling price\s+(\d+(?:\.\d+)?)/);
    const amountMatch = lowerCommand.match(/(?:expense|transport|delivery|fuel|vehicle|rent|loading|unloading|salary|electricity|food|travel|maintenance)[^\d]*(\d+(?:\.\d+)?)/);
    const actionType = lowerCommand.match(/\b(task|call|remind|follow up)\b/)
      ? "create_task"
      : lowerCommand.match(expenseActionKeywords)
        ? "create_expense_draft"
        : lowerCommand.match(/\b(purchase|bought|buy|from supplier)\b/)
          ? "create_purchase_draft"
          : lowerCommand.match(/\b(sale|sell|sold|customer)\b/)
            ? "create_sale_draft"
            : "unknown";
    const parsedData: Record<string, unknown> = {
      title: actionType === "create_task" ? trimmedCommand.replace(/^add task:\s*/i, "").trim() : null,
      product_id: matchedProduct?.id ?? null,
      customer_id: matchedCustomer?.id ?? null,
      supplier_id: matchedSupplier?.id ?? null,
      quantity: actionType === "create_purchase_draft" || actionType === "create_sale_draft" ? extractQuantityFromText(trimmedCommand) : null,
      purchase_price: purchasePriceMatch ? Number(purchasePriceMatch[1]) : actionType === "create_purchase_draft" ? extractPriceFromText(trimmedCommand, "purchase_price") : null,
      selling_price: sellingPriceMatch ? Number(sellingPriceMatch[1]) : actionType === "create_purchase_draft" || actionType === "create_sale_draft" ? extractPriceFromText(trimmedCommand, "selling_price") : null,
      payment_type: lowerCommand.includes("credit") ? "credit" : lowerCommand.includes("cash") ? "cash" : null,
      amount: amountMatch ? Number(amountMatch[1]) : actionType === "create_expense_draft" ? extractFirstNonSizeNumber(trimmedCommand) : null,
      expense_type: actionType === "create_expense_draft" ? detectAiExpenseType(lowerCommand) : null,
      original_command: trimmedCommand,
    };
    return { actionType, ...evaluateAiDraftData(actionType, parsedData) };
  };

  const addAiActionMessage = async ({
    draftId,
    role,
    messageType,
    messageText,
    relatedField = null,
    parsedValue = null,
  }: {
    draftId: string | null;
    role: "owner" | "assistant" | "system";
    messageType: "command" | "question" | "answer" | "confirmation" | "execution" | "error" | "text";
    messageText: string;
    relatedField?: string | null;
    parsedValue?: unknown;
  }) => {
    if (!currentOrganizationId || !messageText.trim()) {
      return null;
    }

    const payload = {
      organization_id: currentOrganizationId,
      profile_id: currentProfile?.id ?? null,
      ai_action_draft_id: draftId,
      role,
      message_type: messageType,
      message_text: messageText.trim(),
      related_field: relatedField ?? null,
      parsed_value: parsedValue ?? null,
    };

    const { data, error } = await supabase
      .from("ai_action_messages")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("Supabase AI action message insert error:", JSON.stringify(error, null, 2));
      return null;
    }

    return data as AiActionMessage;
  };

  const ensureAiQuestionMessage = async (
    draft: AiActionDraft,
    field: string,
    existingMessages: AiActionMessage[] = aiConversationMessages
  ) => {
    if (!field) return existingMessages;
    const alreadyAsked = existingMessages.some(
      (message) => message.role === "assistant" && message.message_type === "question" && message.related_field === field
    );
    if (alreadyAsked) {
      return existingMessages;
    }

    const questionText = aiConversationQuestionText[field] ?? aiQuestionLabels[field] ?? `Please provide ${field}.`;
    const insertedMessage = await addAiActionMessage({
      draftId: draft.id,
      role: "assistant",
      messageType: "question",
      messageText: questionText,
      relatedField: field,
    });
    return insertedMessage ? [...existingMessages, insertedMessage] : existingMessages;
  };

  const getConversationDraft = () =>
    aiActionDrafts.find((draft) => draft.id === selectedConversationDraftId) ?? null;

  const parseConversationAnswer = (draft: AiActionDraft, field: string, answer: string) => {
    const trimmedAnswer = answer.trim();
    const lowerAnswer = trimmedAnswer.toLowerCase();
    let parsedValue: unknown = null;
    let matchedCustomerId: string | null = draft.related_customer_id ?? null;
    let matchedSupplierId: string | null = draft.related_supplier_id ?? null;
    let matchedProductId: string | number | null = draft.related_product_id ?? null;

    if (field === "supplier_id") {
      const matchedSupplier = matchTextEntity(trimmedAnswer, suppliers, (supplier) => [
        supplier.supplier_name,
        supplier.contact_person,
      ]);
      parsedValue = matchedSupplier?.id ?? null;
      matchedSupplierId = matchedSupplier?.id ?? null;
    } else if (field === "customer_id") {
      const matchedCustomer = matchTextEntity(trimmedAnswer, customers, (customer) => [
        customer.customer_name,
        customer.shop_name,
      ]);
      parsedValue = matchedCustomer?.id ?? null;
      matchedCustomerId = matchedCustomer?.id ?? null;
    } else if (field === "product_id") {
      const matchedProduct = matchProductFromText(trimmedAnswer);
      parsedValue = matchedProduct?.id ?? null;
      matchedProductId = matchedProduct?.id ?? null;
    } else if (field === "quantity") {
      parsedValue = extractQuantityFromText(trimmedAnswer) ?? extractFirstNonSizeNumber(trimmedAnswer);
    } else if (field === "purchase_price") {
      parsedValue = extractPriceFromText(trimmedAnswer, "purchase_price");
    } else if (field === "selling_price") {
      parsedValue = extractPriceFromText(trimmedAnswer, "selling_price");
    } else if (field === "payment_type") {
      parsedValue = lowerAnswer.includes("credit") ? "credit" : lowerAnswer.includes("cash") ? "cash" : null;
    } else if (field === "amount") {
      parsedValue = extractFirstNonSizeNumber(trimmedAnswer);
    } else if (field === "expense_type") {
      parsedValue = detectAiExpenseType(lowerAnswer) ?? expenseTypes.find((type) => type.toLowerCase() === lowerAnswer) ?? null;
    } else if (field === "title") {
      parsedValue = trimmedAnswer || null;
    } else {
      parsedValue = trimmedAnswer || null;
    }

    return {
      parsedValue,
      related_customer_id: matchedCustomerId,
      related_supplier_id: matchedSupplierId,
      related_product_id: matchedProductId,
    };
  };

  const createAiActionDraft = async () => {
    setAiAssistantError(null);
    setAiAssistantMessage(null);

    if (!requireOrganization("create AI action draft")) {
      setAiAssistantError("Organization not loaded. Please login again.");
      return;
    }

    if (!currentProfile?.id) {
      setAiAssistantError("Current profile is not loaded. Please login again.");
      return;
    }

    const commandText = aiCommandText.trim();
    if (!commandText) {
      setAiAssistantError("Enter a business command first.");
      return;
    }

    const parsed = parseAiCommand(commandText);
    const now = new Date().toISOString();
    const payload = {
      organization_id: currentOrganizationId,
      profile_id: currentProfile.id,
      command_text: commandText,
      action_type: parsed.actionType,
      status: "draft",
      parsed_data: parsed.parsedData,
      missing_fields: parsed.missingFields,
      confirmation_summary: parsed.confirmationSummary,
      follow_up_questions: parsed.followUpQuestions,
      follow_up_answers: {},
      ready_to_execute: parsed.readyToExecute,
      execution_preview: parsed.executionPreview,
      related_customer_id: parsed.related_customer_id,
      related_supplier_id: parsed.related_supplier_id,
      related_product_id: parsed.related_product_id,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from("ai_action_drafts")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("Supabase AI action draft insert error:", JSON.stringify(error, null, 2));
      setAiAssistantError(`Failed to create AI action draft: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "ai_action_draft",
      entity_id: data?.id ?? null,
      entity_label: parsed.actionType,
      description: `Created AI action draft: ${parsed.confirmationSummary}`,
      new_values: payload,
    });
    setSelectedAiDraftId(data?.id ?? "");
    setSelectedConversationDraftId(data?.id ?? "");
    setAiCommandText("");
    setAiAssistantMessage("Draft action created for owner review.");
    await fetchAiActionDrafts(currentOrganizationId);
    if (data?.id) {
      await continueAiConversation(data as AiActionDraft);
    }
  };

  const updateAiDraftStatus = async (
    draft: AiActionDraft,
    nextStatus: "needs_info" | "cancelled"
  ) => {
    if (!requireOrganization("update AI action draft")) {
      setAiAssistantError("Organization not loaded. Please login again.");
      return;
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("ai_action_drafts")
      .update({
        status: nextStatus,
        updated_at: now,
        error_message: null,
      })
      .eq("id", draft.id)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase AI action draft update error:", JSON.stringify(error, null, 2));
      setAiAssistantError(`Failed to update draft: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: nextStatus === "cancelled" ? "cancelled" : "updated",
      entity_type: "ai_action_draft",
      entity_id: draft.id,
      entity_label: draft.action_type,
      description: `${nextStatus === "cancelled" ? "Cancelled" : "Marked needs info for"} AI action draft`,
      old_values: { status: draft.status },
      new_values: { status: nextStatus },
    });
    setAiAssistantMessage(nextStatus === "cancelled" ? "Draft cancelled." : "Draft marked as needs info.");
    setAiAssistantError(null);
    await fetchAiActionDrafts(currentOrganizationId);
  };

  const saveAiDraftAnswers = async (draft: AiActionDraft) => {
    setAiAssistantError(null);
    setAiAssistantMessage(null);

    if (!requireOrganization("save AI draft answers")) {
      setAiAssistantError("Organization not loaded. Please login again.");
      return;
    }

    const answers = aiDraftAnswerInputs[draft.id] ?? {};
    const normalizedAnswers = Object.entries(answers).reduce<Record<string, unknown>>((values, [field, value]) => {
      if (["quantity", "purchase_price", "selling_price", "amount"].includes(field)) {
        const numericValue = Number(value);
        values[field] = Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
      } else {
        values[field] = value || null;
      }
      return values;
    }, {});
    const previousAnswers = draft.follow_up_answers ?? {};
    const parsedData = {
      ...(draft.parsed_data ?? {}),
      ...normalizedAnswers,
    };
    const evaluation = evaluateAiDraftData(draft.action_type, parsedData);
    const now = new Date().toISOString();
    const updatePayload = {
      parsed_data: evaluation.parsedData,
      missing_fields: evaluation.missingFields,
      confirmation_summary: evaluation.confirmationSummary,
      follow_up_questions: evaluation.followUpQuestions,
      follow_up_answers: {
        ...previousAnswers,
        ...normalizedAnswers,
      },
      ready_to_execute: evaluation.readyToExecute,
      execution_preview: evaluation.executionPreview,
      related_customer_id: evaluation.related_customer_id,
      related_supplier_id: evaluation.related_supplier_id,
      related_product_id: evaluation.related_product_id,
      status: evaluation.readyToExecute ? "draft" : "needs_info",
      updated_at: now,
      error_message: null,
    };

    const { error } = await supabase
      .from("ai_action_drafts")
      .update(updatePayload)
      .eq("id", draft.id)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase AI draft answers update error:", JSON.stringify(error, null, 2));
      setAiAssistantError(`Failed to save answers: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "updated",
      entity_type: "ai_action_draft",
      entity_id: draft.id,
      entity_label: draft.action_type,
      description: "Updated AI action draft follow-up answers",
      old_values: { missing_fields: draft.missing_fields, follow_up_answers: previousAnswers },
      new_values: updatePayload,
    });
    setAiDraftAnswerInputs((current) => ({ ...current, [draft.id]: {} }));
    setAiAssistantMessage(evaluation.readyToExecute ? "Answers saved. Draft is ready for owner execution." : "Answers saved. More information is still needed.");
    await fetchAiActionDrafts(currentOrganizationId);
  };

  const continueAiConversation = async (draft: AiActionDraft) => {
    setAiConversationError(null);
    setAiConversationMessage(null);
    setSelectedConversationDraftId(draft.id);
    setSelectedAiDraftId(draft.id);

    const existingMessages = await fetchAiActionMessages(draft.id, currentOrganizationId);
    let nextMessages = existingMessages;
    if (!nextMessages.some((message) => message.message_type === "command")) {
      const commandMessage = await addAiActionMessage({
        draftId: draft.id,
        role: "owner",
        messageType: "command",
        messageText: draft.command_text,
      });
      if (commandMessage) nextMessages = [...nextMessages, commandMessage];
    }

    const evaluation = evaluateAiDraftData(draft.action_type, draft.parsed_data ?? {});
    const missingFields =
      getAiDraftMissingFields(draft).length > 0 ? getAiDraftMissingFields(draft) : evaluation.missingFields;
    const nextField = getNextMissingField(draft.action_type, missingFields);
    setActiveMissingField(nextField);

    if (nextField) {
      nextMessages = await ensureAiQuestionMessage(draft, nextField, nextMessages);
      setAiConversationMessage("Conversation opened. Answer the current question to continue.");
    } else if (draft.ready_to_execute || evaluation.readyToExecute) {
      const hasConfirmation = nextMessages.some((message) => message.message_type === "confirmation");
      if (!hasConfirmation) {
        const confirmationMessage = await addAiActionMessage({
          draftId: draft.id,
          role: "assistant",
          messageType: "confirmation",
          messageText: `${evaluation.confirmationSummary} Should I execute this now?`,
        });
        if (confirmationMessage) nextMessages = [...nextMessages, confirmationMessage];
      }
      setAiConversationMessage("Draft is ready. Confirm before execution.");
    }

    setAiConversationMessages(nextMessages);
  };

  const sendAiConversationAnswer = async () => {
    setAiConversationError(null);
    setAiConversationMessage(null);

    if (!requireOrganization("send AI conversation answer")) {
      setAiConversationError("Organization not loaded. Please login again.");
      return;
    }

    const draft = getConversationDraft();
    if (!draft) {
      setAiConversationError("Select a draft conversation first.");
      return;
    }

    const answer = aiConversationInput.trim();
    if (!answer) {
      setAiConversationError("Type or speak an answer first.");
      return;
    }

    const lowerAnswer = answer.toLowerCase();
    const evaluationBeforeAnswer = evaluateAiDraftData(draft.action_type, draft.parsed_data ?? {});
    const isReady = Boolean(draft.ready_to_execute || evaluationBeforeAnswer.readyToExecute);

    await addAiActionMessage({
      draftId: draft.id,
      role: "owner",
      messageType: "answer",
      messageText: answer,
      relatedField: activeMissingField || null,
    });

    if (isReady && /^(yes|confirm|proceed|save it|execute|execute now)$/i.test(lowerAnswer)) {
      await addAiActionMessage({
        draftId: draft.id,
        role: "assistant",
        messageType: "execution",
        messageText: "Owner confirmed execution from conversation.",
      });
      await createAuditLog({
        action: "executed",
        entity_type: "ai_action_draft",
        entity_id: draft.id,
        entity_label: draft.action_type,
        description: "AI draft execution confirmed from conversation",
      });
      setAiConversationInput("");
      await executeAiActionDraft(draft);
      await fetchAiActionMessages(draft.id, currentOrganizationId);
      return;
    }

    if (isReady && /^(no|cancel|stop)$/i.test(lowerAnswer)) {
      await updateAiDraftStatus(draft, "cancelled");
      await addAiActionMessage({
        draftId: draft.id,
        role: "assistant",
        messageType: "text",
        messageText: "Draft cancelled from conversation.",
      });
      setAiConversationInput("");
      await fetchAiActionMessages(draft.id, currentOrganizationId);
      return;
    }

    const missingFields =
      getAiDraftMissingFields(draft).length > 0 ? getAiDraftMissingFields(draft) : evaluationBeforeAnswer.missingFields;
    const field = activeMissingField || getNextMissingField(draft.action_type, missingFields);
    if (!field) {
      await addAiActionMessage({
        draftId: draft.id,
        role: "assistant",
        messageType: "confirmation",
        messageText: `${evaluationBeforeAnswer.confirmationSummary} Should I execute this now?`,
      });
      setAiConversationInput("");
      await fetchAiActionMessages(draft.id, currentOrganizationId);
      return;
    }

    const parsedAnswer = parseConversationAnswer(draft, field, answer);
    if (parsedAnswer.parsedValue === null || parsedAnswer.parsedValue === "") {
      await addAiActionMessage({
        draftId: draft.id,
        role: "assistant",
        messageType: "question",
        messageText: `I could not understand that answer. ${aiConversationQuestionText[field] ?? "Please try again."}`,
        relatedField: field,
      });
      setAiConversationInput("");
      await fetchAiActionMessages(draft.id, currentOrganizationId);
      return;
    }

    const previousAnswers = draft.follow_up_answers ?? {};
    const parsedData = {
      ...(draft.parsed_data ?? {}),
      [field]: parsedAnswer.parsedValue,
    };
    const evaluation = evaluateAiDraftData(draft.action_type, parsedData);
    const now = new Date().toISOString();
    const updatePayload = {
      parsed_data: evaluation.parsedData,
      missing_fields: evaluation.missingFields,
      confirmation_summary: evaluation.confirmationSummary,
      follow_up_questions: evaluation.followUpQuestions,
      follow_up_answers: {
        ...previousAnswers,
        [field]: parsedAnswer.parsedValue,
      },
      ready_to_execute: evaluation.readyToExecute,
      execution_preview: evaluation.executionPreview,
      related_customer_id: parsedAnswer.related_customer_id ?? evaluation.related_customer_id,
      related_supplier_id: parsedAnswer.related_supplier_id ?? evaluation.related_supplier_id,
      related_product_id: parsedAnswer.related_product_id ?? evaluation.related_product_id,
      status: evaluation.readyToExecute ? "draft" : "needs_info",
      updated_at: now,
      error_message: null,
    };

    const { error } = await supabase
      .from("ai_action_drafts")
      .update(updatePayload)
      .eq("id", draft.id)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase AI conversation draft update error:", JSON.stringify(error, null, 2));
      setAiConversationError(`Failed to update draft from answer: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await addAiActionMessage({
      draftId: draft.id,
      role: "system",
      messageType: "answer",
      messageText: `Saved answer for ${field}.`,
      relatedField: field,
      parsedValue: parsedAnswer.parsedValue,
    });
    await createAuditLog({
      action: "updated",
      entity_type: "ai_action_draft",
      entity_id: draft.id,
      entity_label: draft.action_type,
      description: `Saved AI conversation answer for ${field}`,
      new_values: { [field]: parsedAnswer.parsedValue },
    });

    await fetchAiActionDrafts(currentOrganizationId);
    const refreshedDraft = {
      ...draft,
      ...updatePayload,
    } as AiActionDraft;
    const nextField = getNextMissingField(refreshedDraft.action_type, evaluation.missingFields);
    setActiveMissingField(nextField);
    if (nextField) {
      await ensureAiQuestionMessage(refreshedDraft, nextField);
      setAiConversationMessage("Answer saved. Next question is ready.");
    } else {
      await addAiActionMessage({
        draftId: draft.id,
        role: "assistant",
        messageType: "confirmation",
        messageText: `${evaluation.confirmationSummary} Should I execute this now?`,
      });
      setAiConversationMessage("Draft is complete. Confirm before execution.");
    }
    setAiConversationInput("");
    await fetchAiActionMessages(draft.id, currentOrganizationId);
  };

  const executeAiActionDraft = async (draft: AiActionDraft) => {
    setAiAssistantError(null);
    setAiAssistantMessage(null);

    if (!requireOrganization("execute AI action draft")) {
      setAiAssistantError("Organization not loaded. Please login again.");
      return;
    }

    if (!currentProfile?.id) {
      setAiAssistantError("Current profile is not loaded. Please login again.");
      return;
    }

    if (draft.status !== "draft" && draft.status !== "needs_info") {
      setAiAssistantError("Only draft or needs-info AI actions can be executed.");
      return;
    }

    const evaluation = evaluateAiDraftData(draft.action_type, draft.parsed_data ?? {});
    const missingFields = evaluation.missingFields;
    if (missingFields.length > 0) {
      setAiAssistantError(`This draft needs more information first: ${missingFields.join(", ")}.`);
      return;
    }

    if (!draft.ready_to_execute && !evaluation.readyToExecute) {
      setAiAssistantError("Owner confirmation requires this draft to be ready to execute first. Save answers before executing.");
      return;
    }

    const parsedData = draft.parsed_data ?? {};
    const now = new Date().toISOString();
    const markDraftFailed = async (message: string, errorDetails?: unknown) => {
      const errorMessage = errorDetails ? JSON.stringify(errorDetails, null, 2) : message;
      await supabase
        .from("ai_action_drafts")
        .update({
          status: "failed",
          error_message: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft.id)
        .eq("organization_id", currentOrganizationId);
      setAiAssistantError(message);
      await fetchAiActionDrafts(currentOrganizationId);
    };

    if (draft.action_type === "create_expense_draft") {
      const amount = Number(parsedData.amount);
      const expenseTypeValue = safeTextOrNull(parsedData.expense_type);
      if (!Number.isFinite(amount) || amount <= 0 || !expenseTypeValue || !expenseTypes.includes(expenseTypeValue)) {
        setAiAssistantError("Expense drafts require a valid amount and supported expense type before execution.");
        return;
      }

      const linkedPurchaseId = normalizeOptionalUuid(parsedData.purchase_transaction_id);
      const expensePayload = {
        organization_id: currentOrganizationId,
        expense_type: expenseTypeValue,
        amount,
        notes: safeTextOrNull(parsedData.notes),
        supplier_id: normalizeOptionalUuid(parsedData.supplier_id),
        customer_id: normalizeOptionalUuid(parsedData.customer_id),
        purchase_transaction_id: linkedPurchaseId,
        sales_transaction_id: normalizeOptionalUuid(parsedData.sales_transaction_id),
      };

      const { data: insertedExpense, error: expenseError } = await supabase
        .from("expenses")
        .insert(expensePayload)
        .select("id")
        .single();

      if (expenseError) {
        console.error("Supabase AI expense insert error:", JSON.stringify(expenseError, null, 2));
        await markDraftFailed("Failed to create expense from draft.", expenseError);
        return;
      }

      if (linkedPurchaseId) {
        const { error: statusUpdateError } = await supabase
          .from("purchase_transactions")
          .update({
            expense_review_status: "expenses_added",
            expense_reviewed_at: now,
          })
          .eq("id", linkedPurchaseId)
          .eq("organization_id", currentOrganizationId);

        if (statusUpdateError) {
          console.error("Supabase AI linked purchase expense status update error:", JSON.stringify(statusUpdateError, null, 2));
        }
      }

      const { error: draftError } = await supabase
        .from("ai_action_drafts")
        .update({
          status: "executed",
          executed_entity_type: "expense",
          executed_entity_id: insertedExpense?.id == null ? null : String(insertedExpense.id),
          executed_at: now,
          owner_confirmed_at: now,
          updated_at: now,
          error_message: null,
        })
        .eq("id", draft.id)
        .eq("organization_id", currentOrganizationId);

      if (draftError) {
        console.error("Supabase AI expense draft update error:", JSON.stringify(draftError, null, 2));
        setAiAssistantError(`Expense was created, but draft status could not be updated: ${JSON.stringify(draftError, null, 2)}`);
        await fetchExpenses(currentOrganizationId);
        if (linkedPurchaseId) await fetchPurchaseTransactions(currentOrganizationId);
        return;
      }

      await createAuditLog({
        action: "executed",
        entity_type: "ai_action_draft",
        entity_id: draft.id,
        entity_label: draft.action_type,
        description: `Executed AI expense draft into expense ${expenseTypeValue}`,
        old_values: { status: draft.status },
        new_values: { status: "executed", executed_entity_type: "expense", executed_entity_id: insertedExpense?.id ?? null },
      });
      setAiAssistantMessage("AI expense draft executed into a real expense.");
      await fetchExpenses(currentOrganizationId);
      if (linkedPurchaseId) await fetchPurchaseTransactions(currentOrganizationId);
      await fetchAiActionDrafts(currentOrganizationId);
      return;
    }

    if (draft.action_type === "create_task") {
      const title = String(parsedData.title || draft.command_text).trim();
      const taskPayload = {
        organization_id: currentOrganizationId,
        title,
        task_type: String(parsedData.task_type || "general"),
        priority: "medium",
        status: "pending",
        due_date: null,
        notes: `Created from AI Assistant command: ${draft.command_text}`,
        customer_id: draft.related_customer_id ?? null,
        supplier_id: draft.related_supplier_id ?? null,
        product_id: draft.related_product_id ?? null,
        purchase_transaction_id: null,
        sales_transaction_id: null,
        completed_at: null,
      };

      const { data: insertedTask, error: taskError } = await supabase
        .from("tasks")
        .insert(taskPayload)
        .select("id")
        .single();

      if (taskError) {
        console.error("Supabase AI task insert error:", JSON.stringify(taskError, null, 2));
        await markDraftFailed("Failed to create task from draft.", taskError);
        return;
      }

      const { error: draftError } = await supabase
        .from("ai_action_drafts")
        .update({
          status: "executed",
          executed_entity_type: "task",
          executed_entity_id: insertedTask?.id == null ? null : String(insertedTask.id),
          executed_at: now,
          owner_confirmed_at: now,
          updated_at: now,
          error_message: null,
        })
        .eq("id", draft.id)
        .eq("organization_id", currentOrganizationId);

      if (draftError) {
        console.error("Supabase AI action draft execution update error:", JSON.stringify(draftError, null, 2));
        setAiAssistantError(`Task was created, but draft status could not be updated: ${JSON.stringify(draftError, null, 2)}`);
        await fetchTasks(currentOrganizationId);
        return;
      }

      await createAuditLog({
        action: "executed",
        entity_type: "ai_action_draft",
        entity_id: draft.id,
        entity_label: draft.action_type,
        description: `Executed AI action draft into task ${title}`,
        old_values: { status: draft.status },
        new_values: { status: "executed", executed_entity_type: "task", executed_entity_id: insertedTask?.id ?? null },
      });
      setAiAssistantMessage("AI task draft executed into a real task.");
      await fetchTasks(currentOrganizationId);
      await fetchAiActionDrafts(currentOrganizationId);
      return;
    }

    if (draft.action_type === "create_purchase_draft") {
      const supplierId = String(parsedData.supplier_id ?? "");
      const productId = String(parsedData.product_id ?? "");
      const quantity = Number(parsedData.quantity);
      const purchasePrice = Number(parsedData.purchase_price);
      const sellingPrice = Number(parsedData.selling_price);
      const invoiceNumber = generateAiInvoiceNumber("AI-PUR");

      const transactionResult = await supabase
        .from("purchase_transactions")
        .insert({
          supplier_id: supplierId,
          invoice_number: invoiceNumber,
          purchase_date: toDateInputValue(new Date()),
          notes: "Created from AI Assistant draft",
          expense_review_status: "pending",
          organization_id: currentOrganizationId,
        })
        .select()
        .single();

      if (transactionResult.error) {
        console.error("Supabase AI purchase transaction insert error:", JSON.stringify(transactionResult.error, null, 2));
        await markDraftFailed("Failed to create purchase invoice from draft.", transactionResult.error);
        return;
      }

      const purchaseTransactionId = transactionResult.data?.id;
      if (!purchaseTransactionId) {
        await markDraftFailed("Failed to create purchase invoice from draft.");
        return;
      }

      const { error: itemError } = await supabase.from("purchase_items").insert({
        purchase_transaction_id: purchaseTransactionId,
        product_id: productId,
        quantity,
        purchase_price: purchasePrice,
        selling_price: sellingPrice,
        batch_number: null,
        expiry_date: null,
      });

      if (itemError) {
        console.error("Supabase AI purchase item insert error:", JSON.stringify(itemError, null, 2));
        await markDraftFailed("Purchase invoice was created, but purchase item could not be saved.", itemError);
        return;
      }

      const { error: productUpdateError } = await supabase
        .from("products")
        .update({ default_selling_price: sellingPrice })
        .eq("id", productId)
        .eq("organization_id", currentOrganizationId);
      if (productUpdateError) {
        console.error("Supabase AI product selling price update error:", JSON.stringify(productUpdateError, null, 2));
      }

      const { error: draftError } = await supabase
        .from("ai_action_drafts")
        .update({
          status: "executed",
          executed_entity_type: "purchase_invoice",
          executed_entity_id: String(purchaseTransactionId),
          executed_at: now,
          owner_confirmed_at: now,
          updated_at: now,
          error_message: null,
        })
        .eq("id", draft.id)
        .eq("organization_id", currentOrganizationId);

      if (draftError) {
        console.error("Supabase AI purchase draft update error:", JSON.stringify(draftError, null, 2));
        setAiAssistantError(`Purchase was created, but draft status could not be updated: ${JSON.stringify(draftError, null, 2)}`);
        return;
      }

      await createAuditLog({
        action: "executed",
        entity_type: "ai_action_draft",
        entity_id: draft.id,
        entity_label: draft.action_type,
        description: `Executed AI purchase draft into invoice ${invoiceNumber}`,
        new_values: { purchase_transaction_id: purchaseTransactionId, invoice_number: invoiceNumber },
      });
      setAiAssistantMessage(`AI purchase draft executed into purchase invoice ${invoiceNumber}.`);
      await fetchPurchaseTransactions(currentOrganizationId);
      await fetchPurchaseItems();
      await fetchProducts(currentOrganizationId);
      await fetchAiActionDrafts(currentOrganizationId);
      return;
    }

    if (draft.action_type === "create_sale_draft") {
      const customerId = String(parsedData.customer_id ?? "");
      const productId = String(parsedData.product_id ?? "");
      const quantity = Number(parsedData.quantity);
      const sellingPrice = Number(parsedData.selling_price);
      const paymentType = String(parsedData.payment_type ?? "");
      if (paymentType !== "cash") {
        setAiAssistantMessage("Credit sale execution will be added in a later phase. For now, AI sale execution supports cash sales only.");
        return;
      }

      const availableStock = getAvailableStockForProduct(productId);
      if (availableStock < quantity) {
        await markDraftFailed(`Not enough stock. Available stock is ${availableStock}, requested quantity is ${quantity}.`);
        return;
      }

      const invoiceNumber = generateAiInvoiceNumber("AI-SALE");
      const saleDate = toDateInputValue(new Date());
      const tx = await supabase
        .from("sales_transactions")
        .insert({
          customer_id: customerId,
          invoice_number: invoiceNumber,
          sale_date: saleDate,
          payment_type: "cash",
          credit_due_date: null,
          credit_limit_snapshot: null,
          credit_days_snapshot: null,
          notes: "Created from AI Assistant draft",
          organization_id: currentOrganizationId,
        })
        .select()
        .single();

      if (tx.error) {
        console.error("Supabase AI sales transaction insert error:", JSON.stringify(tx.error, null, 2));
        await markDraftFailed("Failed to create sales invoice from draft.", tx.error);
        return;
      }

      const salesTransactionId = tx.data?.id;
      if (!salesTransactionId) {
        await markDraftFailed("Failed to create sales invoice from draft.");
        return;
      }

      const { error: itemError } = await supabase.from("sales_items").insert({
        sales_transaction_id: salesTransactionId,
        product_id: productId,
        quantity,
        selling_price: sellingPrice,
        purchase_price_snapshot: getLatestPurchasePriceSnapshotForProduct(productId),
      });

      if (itemError) {
        console.error("Supabase AI sales item insert error:", JSON.stringify(itemError, null, 2));
        await markDraftFailed("Sales invoice was created, but sales item could not be saved.", itemError);
        return;
      }

      const { error: draftError } = await supabase
        .from("ai_action_drafts")
        .update({
          status: "executed",
          executed_entity_type: "sales_invoice",
          executed_entity_id: String(salesTransactionId),
          executed_at: now,
          owner_confirmed_at: now,
          updated_at: now,
          error_message: null,
        })
        .eq("id", draft.id)
        .eq("organization_id", currentOrganizationId);

      if (draftError) {
        console.error("Supabase AI sale draft update error:", JSON.stringify(draftError, null, 2));
        setAiAssistantError(`Sale was created, but draft status could not be updated: ${JSON.stringify(draftError, null, 2)}`);
        return;
      }

      await createAuditLog({
        action: "executed",
        entity_type: "ai_action_draft",
        entity_id: draft.id,
        entity_label: draft.action_type,
        description: `Executed AI sale draft into invoice ${invoiceNumber}`,
        new_values: { sales_transaction_id: salesTransactionId, invoice_number: invoiceNumber },
      });
      setAiAssistantMessage(`AI sale draft executed into sales invoice ${invoiceNumber}.`);
      await fetchSalesTransactions(currentOrganizationId);
      await fetchSalesItems();
      await fetchProducts(currentOrganizationId);
      await fetchAiActionDrafts(currentOrganizationId);
      return;
    }

    setAiAssistantError("This AI action type is not supported for execution yet.");
  };

  const getSpeechRecognitionConstructor = () => {
    if (typeof window === "undefined") return null;
    const speechWindow = window as TradeOsSpeechWindow;
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
  };

  const stopVoiceInput = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onend = null;
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    setIsVoiceListening(false);
    setVoiceInputMessage("Voice input stopped.");
  };

  const startVoiceInput = () => {
    setVoiceInputError(null);
    setVoiceInputMessage(null);

    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionConstructor) {
      setVoiceInputError("This browser does not support speech recognition. Try Chrome or another supported browser.");
      setIsVoiceListening(false);
      return;
    }

    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionConstructor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
      }
      const cleanedTranscript = transcript.trim();
      setVoiceTranscriptPreview(cleanedTranscript);
      if (cleanedTranscript) {
        setAiCommandText(cleanedTranscript);
      }
    };
    recognition.onerror = (event) => {
      const errorCode = event.error ?? "unknown";
      setVoiceInputError(`Voice input error: ${errorCode}. Please check microphone permission and try again.`);
      setVoiceInputMessage(null);
      setIsVoiceListening(false);
    };
    recognition.onend = () => {
      setIsVoiceListening(false);
      setVoiceInputMessage("Voice input finished. Review the command text before creating a draft.");
      speechRecognitionRef.current = null;
    };

    try {
      speechRecognitionRef.current = recognition;
      recognition.start();
      setIsVoiceListening(true);
      setVoiceInputMessage("Listening... speak your TradeOS command");
    } catch (err) {
      speechRecognitionRef.current = null;
      setIsVoiceListening(false);
      setVoiceInputError(err instanceof Error ? err.message : "Could not start voice input.");
    }
  };

  const clearVoiceCommand = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onend = null;
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    setIsVoiceListening(false);
    setAiCommandText("");
    setVoiceTranscriptPreview("");
    setVoiceInputMessage(null);
    setVoiceInputError(null);
  };

  const stopVoiceAnswerInput = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onend = null;
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    setIsVoiceAnswerListening(false);
    setVoiceAnswerMessage("Voice answer stopped.");
  };

  const startVoiceAnswerInput = () => {
    setVoiceAnswerError(null);
    setVoiceAnswerMessage(null);

    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionConstructor) {
      setVoiceAnswerError("This browser does not support speech recognition. Try Chrome or another supported browser.");
      setIsVoiceAnswerListening(false);
      return;
    }

    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionConstructor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
      }
      const cleanedTranscript = transcript.trim();
      if (cleanedTranscript) {
        setAiConversationInput(cleanedTranscript);
      }
    };
    recognition.onerror = (event) => {
      const errorCode = event.error ?? "unknown";
      setVoiceAnswerError(`Voice answer error: ${errorCode}. Please check microphone permission and try again.`);
      setVoiceAnswerMessage(null);
      setIsVoiceAnswerListening(false);
    };
    recognition.onend = () => {
      setIsVoiceAnswerListening(false);
      setVoiceAnswerMessage("Voice answer finished. Review the answer before sending.");
      speechRecognitionRef.current = null;
    };

    try {
      speechRecognitionRef.current = recognition;
      recognition.start();
      setIsVoiceAnswerListening(true);
      setVoiceAnswerMessage("Listening... answer the current TradeOS question");
    } catch (err) {
      speechRecognitionRef.current = null;
      setIsVoiceAnswerListening(false);
      setVoiceAnswerError(err instanceof Error ? err.message : "Could not start voice answer input.");
    }
  };

  const clearVoiceAnswerInput = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onend = null;
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    setIsVoiceAnswerListening(false);
    setAiConversationInput("");
    setVoiceAnswerMessage(null);
    setVoiceAnswerError(null);
  };

  const getGeolocationPosition = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        reject(new Error("This browser does not support location tracking."));
        return;
      }

      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 30000,
      });
    });

  const getLocationErrorMessage = (error: unknown) => {
    const geoError =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: number; message?: string })
        : null;

    if (geoError?.code) {
      if (geoError.code === 1) {
        return "Location permission was denied. Please allow location access to start duty tracking.";
      }
      if (geoError.code === 2) {
        return "Location is currently unavailable. Please check GPS/location settings and try again.";
      }
      if (geoError.code === 3) {
        return "Location request timed out. Please try again.";
      }
    }

    return error instanceof Error ? error.message : geoError?.message ?? "Could not read current location.";
  };

  const positionToSnapshot = (position: GeolocationPosition, capturedAt = new Date().toISOString()): CurrentLocationSnapshot => ({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
    speed: position.coords.speed ?? null,
    heading: position.coords.heading ?? null,
    altitude: position.coords.altitude ?? null,
    captured_at: capturedAt,
  });

  const saveLocationPoint = async (
    sessionId: string,
    snapshot: CurrentLocationSnapshot,
    options: { force?: boolean } = {}
  ) => {
    if (!currentOrganizationId || !currentProfile?.id || !sessionId) {
      return;
    }

    const capturedAtTime = new Date(snapshot.captured_at).getTime();
    const lastSaved = lastSavedLocationRef.current;
    const distanceFromLastSaved =
      lastSaved && Number.isFinite(lastSaved.latitude) && Number.isFinite(lastSaved.longitude)
        ? calculateDistanceMeters(
            lastSaved.latitude,
            lastSaved.longitude,
            snapshot.latitude,
            snapshot.longitude
          )
        : Number.POSITIVE_INFINITY;
    const enoughTimePassed = !lastSaved || capturedAtTime - lastSaved.capturedAt >= 60000;
    const meaningfulDistance = distanceFromLastSaved >= 50;

    if (!options.force && !enoughTimePassed && !meaningfulDistance) {
      return;
    }

    const payload = {
      organization_id: currentOrganizationId,
      profile_id: currentProfile.id,
      duty_session_id: sessionId,
      latitude: snapshot.latitude,
      longitude: snapshot.longitude,
      accuracy: snapshot.accuracy,
      speed: snapshot.speed,
      heading: snapshot.heading,
      altitude: snapshot.altitude,
      captured_at: snapshot.captured_at,
    };

    const { error } = await supabase.from("staff_location_points").insert(payload);

    if (error) {
      console.error("Supabase staff location point insert error:", JSON.stringify(error, null, 2));
      setLocationTrackingError(`Could not save latest location: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    lastSavedLocationRef.current = {
      latitude: snapshot.latitude,
      longitude: snapshot.longitude,
      capturedAt: capturedAtTime,
    };
    setLocationTrackingMessage(`Location updated at ${formatDateTime(snapshot.captured_at)}.`);
    await fetchLocationPoints(currentOrganizationId);
  };

  const stopLocationWatch = () => {
    if (typeof navigator !== "undefined" && navigator.geolocation && locationWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(locationWatchIdRef.current);
    }
    locationWatchIdRef.current = null;
    setIsTrackingLocation(false);
  };

  const startLocationWatch = (sessionId: string) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationTrackingError("This browser does not support live location tracking.");
      return;
    }

    activeDutySessionIdRef.current = sessionId;
    if (locationWatchIdRef.current !== null) {
      setIsTrackingLocation(true);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const snapshot = positionToSnapshot(position);
        setCurrentDutyLocation(snapshot);
        const activeSessionId = activeDutySessionIdRef.current;
        if (activeSessionId) {
          void saveLocationPoint(activeSessionId, snapshot);
        }
      },
      (error) => {
        setLocationTrackingError(getLocationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 20000,
      }
    );

    locationWatchIdRef.current = watchId;
    setIsTrackingLocation(true);
    setLocationTrackingMessage("Live location tracking is active while TradeOS remains open.");
  };

  const handleStartDuty = async () => {
    setLocationTrackingError(null);
    setLocationTrackingMessage(null);

    if (!requireOrganization("start duty")) {
      setLocationTrackingError("Organization not loaded. Please login again.");
      return;
    }

    if (!currentProfile?.id) {
      setLocationTrackingError("Current staff profile is not loaded. Please login again.");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationTrackingError("This browser does not support location tracking.");
      return;
    }

    const existingActiveSession = activeDutySession ?? dutySessions.find(
      (session) => session.profile_id === currentProfile.id && session.status === "on_duty"
    );
    if (existingActiveSession) {
      setActiveDutySession(existingActiveSession);
      activeDutySessionIdRef.current = existingActiveSession.id;
      startLocationWatch(existingActiveSession.id);
      setLocationTrackingMessage("Existing active duty session found. Live tracking resumed.");
      return;
    }

    try {
      const position = await getGeolocationPosition();
      const startedAt = new Date().toISOString();
      const snapshot = positionToSnapshot(position, startedAt);

      const { data: session, error: sessionError } = await supabase
        .from("staff_duty_sessions")
        .insert({
          organization_id: currentOrganizationId,
          profile_id: currentProfile.id,
          status: "on_duty",
          started_at: startedAt,
          start_latitude: snapshot.latitude,
          start_longitude: snapshot.longitude,
          start_accuracy: snapshot.accuracy,
          notes: null,
        })
        .select("*")
        .single();

      if (sessionError) {
        console.error("Supabase staff duty session insert error:", JSON.stringify(sessionError, null, 2));
        setLocationTrackingError(`Could not start duty: ${JSON.stringify(sessionError, null, 2)}`);
        return;
      }

      setActiveDutySession(session);
      setCurrentDutyLocation(snapshot);
      activeDutySessionIdRef.current = session.id;
      await saveLocationPoint(session.id, snapshot, { force: true });
      startLocationWatch(session.id);
      await fetchDutySessions(currentOrganizationId, currentProfile.id);
      await createAuditLog({
        action: "created",
        entity_type: "staff_duty",
        entity_id: session.id,
        entity_label: currentProfile.display_name ?? currentProfile.email ?? currentProfile.id,
        description: "Started duty session",
        new_values: { status: "on_duty", started_at: startedAt },
      });
      setLocationTrackingMessage("Duty started. Location tracking is active while TradeOS remains open.");
    } catch (err) {
      setLocationTrackingError(getLocationErrorMessage(err));
    }
  };

  const handleEndDuty = async () => {
    setLocationTrackingError(null);
    setLocationTrackingMessage(null);

    if (!requireOrganization("end duty")) {
      setLocationTrackingError("Organization not loaded. Please login again.");
      return;
    }

    if (!currentProfile?.id) {
      setLocationTrackingError("Current staff profile is not loaded. Please login again.");
      return;
    }

    const sessionToEnd = activeDutySession ?? dutySessions.find(
      (session) => session.profile_id === currentProfile.id && session.status === "on_duty"
    );
    if (!sessionToEnd) {
      stopLocationWatch();
      setLocationTrackingMessage("No active duty session found.");
      return;
    }

    let endSnapshot: CurrentLocationSnapshot | null = null;
    try {
      const position = await getGeolocationPosition();
      endSnapshot = positionToSnapshot(position);
    } catch (err) {
      console.warn("Could not capture final duty location:", err);
    }

    const endedAt = new Date().toISOString();
    const updatePayload = {
      status: "off_duty",
      ended_at: endedAt,
      end_latitude: endSnapshot?.latitude ?? null,
      end_longitude: endSnapshot?.longitude ?? null,
      end_accuracy: endSnapshot?.accuracy ?? null,
      updated_at: endedAt,
    };

    const { error } = await supabase
      .from("staff_duty_sessions")
      .update(updatePayload)
      .eq("id", sessionToEnd.id)
      .eq("organization_id", currentOrganizationId)
      .eq("profile_id", currentProfile.id);

    if (error) {
      console.error("Supabase staff duty session update error:", JSON.stringify(error, null, 2));
      setLocationTrackingError(`Could not end duty: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    if (endSnapshot) {
      setCurrentDutyLocation(endSnapshot);
      await saveLocationPoint(sessionToEnd.id, endSnapshot, { force: true });
    }

    stopLocationWatch();
    setActiveDutySession(null);
    activeDutySessionIdRef.current = null;
    await fetchDutySessions(currentOrganizationId, currentProfile.id);
    await fetchLocationPoints(currentOrganizationId);
    await createAuditLog({
      action: "updated",
      entity_type: "staff_duty",
      entity_id: sessionToEnd.id,
      entity_label: currentProfile.display_name ?? currentProfile.email ?? currentProfile.id,
      description: "Ended duty session",
      old_values: { status: "on_duty" },
      new_values: { status: "off_duty", ended_at: endedAt },
    });
    setLocationTrackingMessage("Duty ended successfully.");
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
      if (!requireOrganization("create sales invoice")) {
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

      await createAuditLog({
        action: "created",
        entity_type: "sales_invoice",
        entity_id: salesTransactionId,
        entity_label: salesInvoiceNumber,
        description: `Created sales invoice ${salesInvoiceNumber} for ${selectedSalesCustomer?.customer_name ?? "Unknown Customer"}`,
        new_values: {
          customer_id: selectedCustomerIdForSale,
          invoice_number: salesInvoiceNumber,
          sale_date: salesInvoiceDate,
          payment_type: salesPaymentType,
        },
      });

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
      if (!requireOrganization("create customer payment")) {
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

      const paymentCustomer = customers.find((customer) => customer.id === selectedCustomerPaymentId);
      await createAuditLog({
        action: allocationsToInsert.length > 0 ? "allocated" : "created",
        entity_type: "customer_payment",
        entity_id: insertedPaymentId,
        entity_label: paymentCustomer?.customer_name ?? "Customer payment",
        description:
          allocationsToInsert.length > 0
            ? `Created and allocated customer payment for ${paymentCustomer?.customer_name ?? "Unknown Customer"}`
            : `Created customer payment for ${paymentCustomer?.customer_name ?? "Unknown Customer"}`,
        new_values: {
          customer_id: selectedCustomerPaymentId,
          amount: paymentAmount,
          notes: customerPaymentNotes || null,
          allocations: allocationsToInsert,
        },
      });

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
    if (supplierPaymentLoading) {
      return;
    }

    if (!selectedSupplierPaymentId) {
      setSupplierPaymentError("Please select a supplier");
      setSupplierPaymentMessage(null);
      return;
    }
    const paymentAmount = Number(supplierPaymentAmount);
    if (!supplierPaymentAmount || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setSupplierPaymentError("Please enter a valid amount");
      setSupplierPaymentMessage(null);
      return;
    }
    const allocationRows = unpaidPurchaseInvoicesForSelectedPaymentSupplier
      .map((invoice) => {
        const allocationAmount = Number(supplierPaymentAllocationsByInvoice[invoice.transaction.id] || 0);
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
      setSupplierPaymentError("Allocation amounts must be zero or greater.");
      setSupplierPaymentMessage(null);
      return;
    }
    const allocationExceedsInvoice = allocationRows.some(
      ({ invoice, allocationAmount }) => allocationAmount > invoice.remainingPayableAmount
    );
    if (allocationExceedsInvoice) {
      setSupplierPaymentError("Allocation cannot exceed an invoice remaining payable amount.");
      setSupplierPaymentMessage(null);
      return;
    }
    const totalAllocationAmount = allocationRows.reduce(
      (sum, row) => sum + row.allocationAmount,
      0
    );
    if (totalAllocationAmount > paymentAmount) {
      setSupplierPaymentError("Total allocations cannot exceed the payment amount.");
      setSupplierPaymentMessage(null);
      return;
    }

    setSupplierPaymentError(null);
    setSupplierPaymentMessage(null);
    setSupplierPaymentLoading(true);

    try {
      if (!requireOrganization("create supplier payment")) {
        setSupplierPaymentError("Organization not loaded. Please login again.");
        setSupplierPaymentLoading(false);
        return;
      }

      const { data: paymentData, error } = await supabase
        .from("supplier_payments")
        .insert({
          supplier_id: selectedSupplierPaymentId,
          amount: paymentAmount,
          notes: supplierPaymentNotes || null,
          organization_id: currentOrganizationId,
        })
        .select("id")
        .single();

      if (error) throw error;

      const insertedSupplierPaymentId = paymentData?.id;
      if (!insertedSupplierPaymentId) {
        throw new Error("Payment saved but no supplier payment id was returned.");
      }

      const allocationsToInsert = allocationRows
        .filter((row) => row.allocationAmount > 0)
        .map((row) => ({
          organization_id: currentOrganizationId,
          supplier_payment_id: insertedSupplierPaymentId,
          purchase_transaction_id: row.invoice.transaction.id,
          amount: row.allocationAmount,
        }));

      if (allocationsToInsert.length > 0) {
        const { error: allocationError } = await supabase
          .from("supplier_payment_allocations")
          .insert(allocationsToInsert);

        if (allocationError) {
          console.error(
            "Supabase supplier payment allocation insert error:",
            JSON.stringify(allocationError, null, 2)
          );
          setSupplierPaymentMessage(null);
          setSupplierPaymentError(
            "Payment saved, but one or more supplier invoice allocations could not be saved."
          );
          await fetchSupplierPayments(currentOrganizationId);
          await fetchSupplierPaymentAllocations(currentOrganizationId);
          setSupplierPaymentLoading(false);
          return;
        }
      }

      const paymentSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierPaymentId);
      await createAuditLog({
        action: allocationsToInsert.length > 0 ? "allocated" : "created",
        entity_type: "supplier_payment",
        entity_id: insertedSupplierPaymentId,
        entity_label: paymentSupplier?.supplier_name ?? "Supplier payment",
        description:
          allocationsToInsert.length > 0
            ? `Created and allocated supplier payment for ${paymentSupplier?.supplier_name ?? "Unknown Supplier"}`
            : `Created supplier payment for ${paymentSupplier?.supplier_name ?? "Unknown Supplier"}`,
        new_values: {
          supplier_id: selectedSupplierPaymentId,
          amount: paymentAmount,
          notes: supplierPaymentNotes || null,
          allocations: allocationsToInsert,
        },
      });

      setSupplierPaymentMessage("Payment saved successfully");
      setSelectedSupplierPaymentId(null);
      setSupplierPaymentAmount("");
      setSupplierPaymentNotes("");
      setSupplierPaymentAllocationsByInvoice({});
      await fetchSupplierPayments(currentOrganizationId);
      await fetchSupplierPaymentAllocations(currentOrganizationId);
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

    if (!requireOrganization("create expense")) {
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

    const { data: expenseData, error } = await supabase.from("expenses").insert({
      organization_id: currentOrganizationId,
      expense_type: expenseType,
      amount,
      notes: expenseNotes.trim() || null,
      supplier_id: selectedExpenseSupplierId || null,
      customer_id: selectedExpenseCustomerId || null,
      purchase_transaction_id: selectedExpensePurchaseId || null,
      sales_transaction_id: selectedExpenseSaleId || null,
    }).select("id").single();

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

    await createAuditLog({
      action: "created",
      entity_type: "expense",
      entity_id: expenseData?.id ?? null,
      entity_label: expenseType,
      description: selectedExpensePurchaseId
        ? `Created linked purchase expense ${expenseType}`
        : `Created expense ${expenseType}`,
      new_values: {
        expense_type: expenseType,
        amount,
        notes: expenseNotes.trim() || null,
        supplier_id: selectedExpenseSupplierId || null,
        customer_id: selectedExpenseCustomerId || null,
        purchase_transaction_id: selectedExpensePurchaseId || null,
        sales_transaction_id: selectedExpenseSaleId || null,
      },
    });

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
    setActiveSection("expenses");
    setSelectedExpensePurchaseId(purchaseId);
    setSelectedExpenseSupplierId(supplierId);
    setSelectedExpenseCustomerId("");
    setSelectedExpenseSaleId("");
    setExpenseType((currentType) => currentType || "Purchase Transport");
    setMobileMenuOpen(false);

    window.setTimeout(() => {
      document.getElementById("expense-management")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      const expenseSection = document.getElementById("expense-management");
      const firstExpenseInput = expenseSection?.querySelector("select, input");
      if (firstExpenseInput instanceof HTMLElement) {
        firstExpenseInput.focus();
      }
    }, 0);
  };

  const updatePurchaseExpenseStatus = async (
    purchaseId: string,
    status: "no_additional_expense" | "review_later"
  ) => {
    setPurchaseExpenseStatusMessage(null);

    if (!requireOrganization("update purchase expense review")) {
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

    const reviewedPurchase = purchaseTransactions.find((transaction) => transaction.id === purchaseId);
    await createAuditLog({
      action: "reviewed",
      entity_type: "purchase_invoice",
      entity_id: purchaseId,
      entity_label: reviewedPurchase?.invoice_number ?? purchaseId,
      description:
        status === "no_additional_expense"
          ? `Marked purchase invoice ${reviewedPurchase?.invoice_number ?? purchaseId} as no additional expense`
          : `Marked purchase invoice ${reviewedPurchase?.invoice_number ?? purchaseId} for review later`,
      new_values: {
        expense_review_status: status,
        expense_reviewed_at: updateData.expense_reviewed_at,
      },
    });
    await fetchPurchaseTransactions(currentOrganizationId);
    setNewPurchaseExpenseReminder(null);
    setPurchaseExpenseStatusMessage(
      status === "no_additional_expense"
        ? "Purchase marked as having no additional expense."
        : "Purchase marked for expense review later."
    );
  };

  const fetchCategories = async (organizationId?: string | null) => {
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

  const fetchProducts = async (organizationId?: string | null) => {
    setProductsLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setProducts([]);
      setProductsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("products")
      .select("id, name, brand_id, category_id, unit_type, last_purchase_price, default_selling_price, minimum_stock_level, reorder_level, track_batch, track_expiry")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });

    setProductsLoading(false);

    if (error) {
      console.error("Supabase fetch products error:", error);
      return;
    }

    setProducts(data ?? []);
  };

  const fetchCustomers = async (organizationId?: string | null) => {
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

  const fetchSuppliers = async (organizationId?: string | null) => {
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

  const fetchPurchaseTransactions = async (organizationId?: string | null) => {
    setPurchaseLoading(true);
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setPurchaseTransactions([]);
      setPurchaseLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("purchase_transactions")
      .select("id, supplier_id, invoice_number, created_at, purchase_date, expense_review_status, expense_reviewed_at")
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
  const [supplierPaymentAllocations, setSupplierPaymentAllocations] = useState<any[]>([]);
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
  const [supplierPaymentAllocationsByInvoice, setSupplierPaymentAllocationsByInvoice] =
    useState<Record<string, string>>({});
  const currentMonthRange = getMonthRange();
  const [selectedSupplierLedgerId, setSelectedSupplierLedgerId] = useState<string>("");
  const [supplierLedgerStartDate, setSupplierLedgerStartDate] = useState(currentMonthRange.start);
  const [supplierLedgerEndDate, setSupplierLedgerEndDate] = useState(currentMonthRange.end);
  const [supplierLedgerDateError, setSupplierLedgerDateError] = useState<string | null>(null);

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
  const [profitLossStartDate, setProfitLossStartDate] = useState(currentMonthRange.start);
  const [profitLossEndDate, setProfitLossEndDate] = useState(currentMonthRange.end);
  const [profitLossDateError, setProfitLossDateError] = useState<string | null>(null);
  const pkrFormatter = new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2,
  });
  const isOwnerOrAdmin = () => {
    const role = currentProfile?.role;
    if (!role) return true;
    return role === "owner" || role === "admin";
  };
  const currentStaffPermission = staffPermissions.find(
    (permission) => permission.profile_id === currentProfile?.id
  );
  const hasPermission = (permissionKey: StaffPermissionKey) => {
    if (isOwnerOrAdmin()) return true;
    return Boolean(currentStaffPermission?.[permissionKey]);
  };
  const sectionPermissionMap: Partial<Record<SectionId, StaffPermissionKey | "owner_admin">> = {
    products: "can_manage_products",
    brands: "can_manage_products",
    categories: "can_manage_products",
    customers: "can_manage_customers",
    suppliers: "can_manage_suppliers",
    purchases: "can_create_purchases",
    sales: "can_create_sales",
    "customer-payments": "can_manage_payments",
    "supplier-payments": "can_manage_payments",
    expenses: "can_manage_expenses",
    "profit-loss": "can_view_profit",
    inventory: "can_view_reports",
    "customer-credit": "can_manage_customers",
    "supplier-ledger": "can_manage_payments",
    "business-settings": "can_manage_settings",
    "task-manager": "can_manage_tasks",
    "activity-logs": "owner_admin",
    "staff-permissions": "owner_admin",
    "security-check": "owner_admin",
    deployment: "owner_admin",
    "mobile-app": "owner_admin",
    "ai-assistant": "owner_admin",
    "market-intelligence": "owner_admin",
  };
  const canAccessSection = (sectionId: SectionId) => {
    if (sectionId === "dashboard") return true;
    const requiredPermission = sectionPermissionMap[sectionId];
    if (!requiredPermission) return true;
    if (requiredPermission === "owner_admin") return isOwnerOrAdmin();
    return hasPermission(requiredPermission);
  };
  const visibleNavigationItems = navigationItems.filter((item) => canAccessSection(item.id));
  const activeSectionLabel =
    navigationItems.find((item) => item.id === activeSection)?.label ?? "Dashboard";
  const activeSectionAllowed = canAccessSection(activeSection);
  const filteredAiActionDrafts = aiActionDrafts.filter((draft) => {
    const evaluation = evaluateAiDraftData(draft.action_type, draft.parsed_data ?? {});
    const isReady = Boolean(draft.ready_to_execute || evaluation.readyToExecute);
    const matchesStatus =
      aiDraftStatusFilter === "all" ||
      (aiDraftStatusFilter === "ready" && isReady && draft.status !== "executed" && draft.status !== "cancelled" && draft.status !== "failed") ||
      draft.status === aiDraftStatusFilter;
    const actionTypeGroup =
      draft.action_type === "create_task"
        ? "task"
        : draft.action_type === "create_purchase_draft"
          ? "purchase"
          : draft.action_type === "create_sale_draft"
            ? "sale"
            : draft.action_type === "create_expense_draft"
              ? "expense"
              : "unknown";
    const matchesActionType = aiDraftActionTypeFilter === "all" || aiDraftActionTypeFilter === actionTypeGroup;
    const search = aiDraftSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      [
        draft.command_text,
        draft.confirmation_summary,
        draft.status,
        draft.action_type,
        draft.error_message,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    return matchesStatus && matchesActionType && matchesSearch;
  });
  const selectedConversationDraft =
    aiActionDrafts.find((draft) => draft.id === selectedConversationDraftId) ?? null;
  const selectedConversationEvaluation = selectedConversationDraft
    ? evaluateAiDraftData(selectedConversationDraft.action_type, selectedConversationDraft.parsed_data ?? {})
    : null;
  const selectedConversationMissingFields = selectedConversationDraft
    ? getAiDraftMissingFields(selectedConversationDraft).length > 0
      ? getAiDraftMissingFields(selectedConversationDraft)
      : selectedConversationEvaluation?.missingFields ?? []
    : [];
  const selectedConversationReady = Boolean(
    selectedConversationDraft?.ready_to_execute || selectedConversationEvaluation?.readyToExecute
  );
  const marketWeekStart = new Date();
  marketWeekStart.setDate(marketWeekStart.getDate() - 7);
  const marketIntelligenceSummary = marketIntelligenceItems.reduce(
    (summary, item) => {
      const createdTime = new Date(item.created_at ?? 0).getTime();
      if (item.status === "active") summary.active += 1;
      if (item.impact_level === "high" || item.impact_level === "critical") summary.highCritical += 1;
      if (item.impact_direction === "price_up") summary.priceUp += 1;
      if (item.impact_direction === "supply_shortage") summary.supplyShortage += 1;
      if (Number.isFinite(createdTime) && createdTime >= marketWeekStart.getTime()) summary.addedThisWeek += 1;
      return summary;
    },
    { active: 0, highCritical: 0, priceUp: 0, supplyShortage: 0, addedThisWeek: 0 }
  );
  const marketImportQueueSummary = marketImportQueueItems.reduce(
    (summary, item) => {
      if (item.review_status === "pending") summary.pending += 1;
      if (item.review_status === "reviewing") summary.reviewing += 1;
      if (item.review_status === "converted") summary.converted += 1;
      if (item.review_status === "ignored") summary.ignored += 1;
      return summary;
    },
    { pending: 0, reviewing: 0, converted: 0, ignored: 0 }
  );
  const marketAiAnalysisSummary = marketAiAnalyses.reduce(
    (summary, analysis) => {
      if (analysis.review_status === "draft") summary.draft += 1;
      if (analysis.ai_impact_level === "high") summary.high += 1;
      if (analysis.ai_impact_level === "critical") summary.critical += 1;
      return summary;
    },
    { draft: 0, high: 0, critical: 0 }
  );
  const filteredMarketIntelligenceItems = marketIntelligenceItems.filter((item) => {
    const search = marketIntelligenceSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      [
        item.title,
        item.summary,
        item.source_name,
        item.suggested_action,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    const matchesCategory =
      marketIntelligenceCategoryFilter === "all" || item.market_category === marketIntelligenceCategoryFilter;
    const matchesImpact =
      marketIntelligenceImpactFilter === "all" || item.impact_direction === marketIntelligenceImpactFilter;
    const matchesStatus =
      marketIntelligenceStatusFilter === "all" || item.status === marketIntelligenceStatusFilter;
    return matchesSearch && matchesCategory && matchesImpact && matchesStatus;
  });
  const filteredMarketImportQueueItems = marketImportQueueItems.filter((item) => {
    const search = marketImportQueueSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      [
        item.raw_title,
        item.raw_summary,
        item.raw_text,
        item.source_name,
        item.source_url,
        item.notes,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    const matchesStatus =
      marketImportQueueStatusFilter === "all" || item.review_status === marketImportQueueStatusFilter;
    return matchesSearch && matchesStatus;
  });
  const ownDutySessions = dutySessions.filter((session) => session.profile_id === currentProfile?.id);
  const ownLocationPoints = locationPoints.filter((point) => point.profile_id === currentProfile?.id);
  const visibleDutySessions = isOwnerOrAdmin() ? dutySessions : ownDutySessions;
  const visibleLocationPoints = isOwnerOrAdmin() ? locationPoints : ownLocationPoints;
  const latestOwnLocation = currentDutyLocation ?? ownLocationPoints[0] ?? null;
  const staffProfileById = staffProfiles.reduce((profiles, profile) => {
    profiles[profile.id] = profile;
    return profiles;
  }, {} as Record<string, StaffProfile>);
  const latestLocationByProfile = visibleLocationPoints.reduce((latest, point) => {
    const existing = latest[point.profile_id];
    const pointTime = new Date(point.captured_at).getTime();
    const existingTime = existing ? new Date(existing.captured_at).getTime() : 0;
    if (!existing || pointTime > existingTime) {
      latest[point.profile_id] = point;
    }
    return latest;
  }, {} as Record<string, StaffLocationPoint>);
  const onDutyProfileIds = new Set(
    dutySessions
      .filter((session) => session.status === "on_duty")
      .map((session) => session.profile_id)
  );
  const ownerOnDutyCount = onDutyProfileIds.size;
  const ownerRecentOffDutyCount = dutySessions.filter((session) => session.status !== "on_duty").length;
  const selectedLocationProfileId = selectedStaffForLocation || currentProfile?.id || "";
  const selectedLocationProfile = staffProfileById[selectedLocationProfileId] ?? null;
  const selectedStaffLocationPoints = visibleLocationPoints
    .filter((point) => point.profile_id === selectedLocationProfileId)
    .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
  const selectedStaffChronologicalPoints = [...selectedStaffLocationPoints].sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
  );
  const possibleStops: Array<{
    startTime: string;
    endTime: string;
    durationMinutes: number;
    latitude: number;
    longitude: number;
  }> = [];
  for (let index = 1; index < selectedStaffChronologicalPoints.length; index += 1) {
    const previousPoint = selectedStaffChronologicalPoints[index - 1];
    const currentPoint = selectedStaffChronologicalPoints[index];
    const distanceMeters = calculateDistanceMeters(
      previousPoint.latitude,
      previousPoint.longitude,
      currentPoint.latitude,
      currentPoint.longitude
    );
    const durationMilliseconds =
      new Date(currentPoint.captured_at).getTime() - new Date(previousPoint.captured_at).getTime();
    if (distanceMeters <= 50 && durationMilliseconds >= 5 * 60 * 1000) {
      possibleStops.push({
        startTime: previousPoint.captured_at,
        endTime: currentPoint.captured_at,
        durationMinutes: Math.round(durationMilliseconds / 60000),
        latitude: currentPoint.latitude,
        longitude: currentPoint.longitude,
      });
    }
  }
  const formatCoordinate = (value: unknown) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toFixed(6) : "-";
  };
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

  const fetchCustomerPayments = async (organizationId?: string | null) => {
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

  const fetchCustomerPaymentAllocations = async (organizationId?: string | null) => {
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

  const fetchSupplierPayments = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setSupplierPayments([]);
      return;
    }

    const { data, error } = await supabase
      .from("supplier_payments")
      .select("id, supplier_id, amount, notes, payment_date, created_at")
      .eq("organization_id", orgId)
      .order("id", { ascending: true });

    if (error) {
      console.error("Supabase fetch supplier payments error:", error);
      return;
    }

    setSupplierPayments(data ?? []);
  };

  const fetchSupplierPaymentAllocations = async (organizationId?: string | null) => {
    const orgId = organizationId ?? currentOrganizationId;
    if (!orgId) {
      setSupplierPaymentAllocations([]);
      return;
    }

    const { data, error } = await supabase
      .from("supplier_payment_allocations")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Supabase fetch supplier payment allocations error:", JSON.stringify(error, null, 2));
      return;
    }

    setSupplierPaymentAllocations(data ?? []);
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

  const fetchSalesTransactions = async (organizationId?: string | null) => {
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

    if (!requireOrganization("add brand")) {
      setBrandError("Organization not loaded. Please login again.");
      setBrandMessage(null);
      return;
    }

    setBrandError(null);
    setBrandMessage(null);
    setBrandsLoading(true);

    const { data, error } = await supabase.from("brands").insert({
      name: brandName,
      organization_id: currentOrganizationId,
    }).select("id").single();

    setBrandsLoading(false);

    if (error) {
      setBrandError("Failed to add brand");
      console.error("Supabase add brand error:", error);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "brand",
      entity_id: data?.id ?? null,
      entity_label: brandName,
      description: `Created brand ${brandName}`,
      new_values: { name: brandName },
    });
    setBrandMessage("Brand added successfully");
    setBrandName("");
    fetchBrands();
  };

  const handleDeleteBrand = async (brandId: string) => {
    setBrandError(null);
    setBrandMessage(null);
    if (!requireOrganization("delete brand")) {
      setBrandError("Organization not loaded. Please login again.");
      return;
    }
    setBrandsLoading(true);

    const brandToDelete = brands.find((brand) => brand.id === brandId);
    const { error } = await supabase
      .from("brands")
      .delete()
      .eq("id", brandId)
      .eq("organization_id", currentOrganizationId);

    setBrandsLoading(false);

    if (error) {
      setBrandError("Failed to delete brand");
      console.error("Supabase delete brand error:", JSON.stringify(error, null, 2));
      return;
    }

    await createAuditLog({
      action: "deleted",
      entity_type: "brand",
      entity_id: brandId,
      entity_label: brandToDelete?.name ?? brandId,
      description: `Deleted brand ${brandToDelete?.name ?? brandId}`,
      old_values: brandToDelete ? { name: brandToDelete.name } : null,
    });
    setBrandMessage("Brand deleted successfully");
    fetchBrands();
  };

  const handleAddCategory = async () => {
    if (!categoryName.trim()) {
      setCategoryError("Category name is required");
      setCategoryMessage(null);
      return;
    }

    if (!requireOrganization("add category")) {
      setCategoryError("Organization not loaded. Please login again.");
      setCategoryMessage(null);
      return;
    }

    setCategoryError(null);
    setCategoryMessage(null);
    setCategoriesLoading(true);

    const { data, error } = await supabase.from("categories").insert({
      name: categoryName,
      parent_category_id: parentCategoryId,
      organization_id: currentOrganizationId,
    }).select("id").single();

    setCategoriesLoading(false);

    if (error) {
      setCategoryError("Failed to add category");
      console.error("Supabase add category error:", error);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "category",
      entity_id: data?.id ?? null,
      entity_label: categoryName,
      description: `Created category ${categoryName}`,
      new_values: { name: categoryName, parent_category_id: parentCategoryId },
    });
    setCategoryMessage("Category added successfully");
    setCategoryName("");
    setParentCategoryId(null);
    fetchCategories();
  };

  const handleDeleteCategory = async (categoryId: string) => {
    setCategoryError(null);
    setCategoryMessage(null);
    if (!requireOrganization("delete category")) {
      setCategoryError("Organization not loaded. Please login again.");
      return;
    }
    setCategoriesLoading(true);

    const categoryToDelete = categories.find((category) => category.id === categoryId);
    const { error } = await supabase
      .from("categories")
      .delete()
      .eq("id", categoryId)
      .eq("organization_id", currentOrganizationId);

    setCategoriesLoading(false);

    if (error) {
      setCategoryError("Failed to delete category");
      console.error("Supabase delete category error:", JSON.stringify(error, null, 2));
      return;
    }

    await createAuditLog({
      action: "deleted",
      entity_type: "category",
      entity_id: categoryId,
      entity_label: categoryToDelete?.name ?? categoryId,
      description: `Deleted category ${categoryToDelete?.name ?? categoryId}`,
      old_values: categoryToDelete
        ? { name: categoryToDelete.name, parent_category_id: categoryToDelete.parent_category_id }
        : null,
    });
    setCategoryMessage("Category deleted successfully");
    fetchCategories();
  };

  const handleDeleteProduct = async (productId: number) => {
    setMessage(null);
    setError(null);
    if (!requireOrganization("delete product")) {
      setError("Organization not loaded. Please login again.");
      return;
    }
    setProductsLoading(true);

    const productToDelete = products.find((product) => product.id === productId);
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("organization_id", currentOrganizationId);

    setProductsLoading(false);

    if (error) {
      setError("Failed to delete product");
      console.error("Supabase delete product error:", JSON.stringify(error, null, 2));
      return;
    }

    await createAuditLog({
      action: "deleted",
      entity_type: "product",
      entity_id: productId,
      entity_label: productToDelete?.name ?? String(productId),
      description: `Deleted product ${productToDelete?.name ?? productId}`,
      old_values: productToDelete
        ? {
            name: productToDelete.name,
            brand_id: productToDelete.brand_id,
            category_id: productToDelete.category_id,
            unit_type: productToDelete.unit_type,
          }
        : null,
    });
    setMessage("Product deleted successfully");
    fetchProducts();
  };

  const handleAddCustomer = async () => {
    if (!customerName.trim()) {
      setCustomerError("Customer name is required");
      setCustomerMessage(null);
      return;
    }

    if (!requireOrganization("add customer")) {
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

    const { data, error } = await supabase.from("customers").insert({
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
    }).select("id").single();

    setCustomersLoading(false);

    if (error) {
      setCustomerError("Failed to save customer");
      console.error("Supabase add customer error:", error);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "customer",
      entity_id: data?.id ?? null,
      entity_label: customerName,
      description: `Created customer ${customerName}`,
      new_values: {
        customer_name: customerName,
        shop_name: shopName || null,
        phone: phone || null,
        city: city || null,
        customer_type: customerType,
        credit_policy: creditPolicy,
      },
    });
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
    if (!requireOrganization("delete customer")) {
      setCustomerError("Organization not loaded. Please login again.");
      return;
    }
    setCustomersLoading(true);

    const customerToDelete = customers.find((customer) => customer.id === customerId);
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", customerId)
      .eq("organization_id", currentOrganizationId);

    setCustomersLoading(false);

    if (error) {
      setCustomerError("Failed to delete customer");
      console.error("Supabase delete customer error:", JSON.stringify(error, null, 2));
      return;
    }

    await createAuditLog({
      action: "deleted",
      entity_type: "customer",
      entity_id: customerId,
      entity_label: customerToDelete?.customer_name ?? customerId,
      description: `Deleted customer ${customerToDelete?.customer_name ?? customerId}`,
      old_values: customerToDelete
        ? {
            customer_name: customerToDelete.customer_name,
            shop_name: customerToDelete.shop_name,
            phone: customerToDelete.phone,
            city: customerToDelete.city,
          }
        : null,
    });
    setCustomerMessage("Customer deleted successfully");
    fetchCustomers();
  };

  const handleAddSupplier = async () => {
    if (!supplierName.trim()) {
      setSupplierError("Supplier name is required");
      setSupplierMessage(null);
      return;
    }

    if (!requireOrganization("add supplier")) {
      setSupplierError("Organization not loaded. Please login again.");
      setSupplierMessage(null);
      return;
    }

    setSupplierError(null);
    setSupplierMessage(null);
    setSuppliersLoading(true);

    const { data, error } = await supabase.from("suppliers").insert({
      supplier_name: supplierName,
      contact_person: contactPerson || null,
      phone: supplierPhone || null,
      whatsapp: supplierWhatsapp || null,
      city: supplierCity || null,
      notes: supplierNotes || null,
      organization_id: currentOrganizationId,
    }).select("id").single();

    setSuppliersLoading(false);

    if (error) {
      setSupplierError("Failed to save supplier");
      console.error("Supabase add supplier error:", error);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "supplier",
      entity_id: data?.id ?? null,
      entity_label: supplierName,
      description: `Created supplier ${supplierName}`,
      new_values: {
        supplier_name: supplierName,
        contact_person: contactPerson || null,
        phone: supplierPhone || null,
        city: supplierCity || null,
      },
    });
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
    if (!requireOrganization("delete supplier")) {
      setSupplierError("Organization not loaded. Please login again.");
      return;
    }
    setSuppliersLoading(true);

    const supplierToDelete = suppliers.find((supplier) => supplier.id === supplierId);
    const { error } = await supabase
      .from("suppliers")
      .delete()
      .eq("id", supplierId)
      .eq("organization_id", currentOrganizationId);

    setSuppliersLoading(false);

    if (error) {
      setSupplierError("Failed to delete supplier");
      console.error("Supabase delete supplier error:", JSON.stringify(error, null, 2));
      return;
    }

    await createAuditLog({
      action: "deleted",
      entity_type: "supplier",
      entity_id: supplierId,
      entity_label: supplierToDelete?.supplier_name ?? supplierId,
      description: `Deleted supplier ${supplierToDelete?.supplier_name ?? supplierId}`,
      old_values: supplierToDelete
        ? {
            supplier_name: supplierToDelete.supplier_name,
            contact_person: supplierToDelete.contact_person,
            phone: supplierToDelete.phone,
            city: supplierToDelete.city,
          }
        : null,
    });
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

      if (!requireOrganization("create purchase invoice")) {
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
            .eq("id", line.product_id)
            .eq("organization_id", currentOrganizationId);

          if (updateError) {
            console.error("Product update error:", JSON.stringify(updateError, null, 2));
          }
        }
      }

      const purchaseSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId);
      await createAuditLog({
        action: "created",
        entity_type: "purchase_invoice",
        entity_id: transactionId,
        entity_label: invoiceNumber,
        description: `Created purchase invoice ${invoiceNumber} for ${purchaseSupplier?.supplier_name ?? "Unknown Supplier"}`,
        new_values: {
          supplier_id: selectedSupplierId,
          invoice_number: invoiceNumber,
          line_count: purchaseLines.length,
        },
      });

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
  const purchaseInvoiceTotalsByTransaction = purchaseTransactions.reduce<Record<string, number>>(
    (totals, transaction) => {
      totals[transaction.id] = purchaseItems
        .filter((item) => item.purchase_transaction_id === transaction.id)
        .reduce(
          (sum, item) => sum + safeNumber(item.quantity) * safeNumber(item.purchase_price),
          0
        );
      return totals;
    },
    {}
  );
  const purchaseTransactionsById = purchaseTransactions.reduce<Record<string, PurchaseTransaction>>(
    (transactions, transaction) => {
      transactions[transaction.id] = transaction;
      return transactions;
    },
    {}
  );
  const supplierAllocatedAmountsByPurchaseTransaction =
    supplierPaymentAllocations.reduce<Record<string, number>>((totals, allocation) => {
      const purchaseTransactionId = String(allocation.purchase_transaction_id ?? "");
      if (!purchaseTransactionId) return totals;
      totals[purchaseTransactionId] =
        (totals[purchaseTransactionId] ?? 0) + safeNumber(allocation.amount);
      return totals;
    }, {});
  const totalSupplierPaymentsBySupplier = supplierPayments.reduce<Record<string, number>>(
    (totals, payment) => {
      const supplierId = String(payment.supplier_id ?? "");
      if (!supplierId) return totals;
      totals[supplierId] = (totals[supplierId] ?? 0) + safeNumber(payment.amount);
      return totals;
    },
    {}
  );
  const explicitSupplierAllocationsBySupplier =
    supplierPaymentAllocations.reduce<Record<string, number>>((totals, allocation) => {
      const purchaseTransactionId = String(allocation.purchase_transaction_id ?? "");
      const transaction = purchaseTransactionsById[purchaseTransactionId];
      if (!transaction) return totals;
      totals[transaction.supplier_id] =
        (totals[transaction.supplier_id] ?? 0) + safeNumber(allocation.amount);
      return totals;
    }, {});
  const legacySupplierPaymentPoolBySupplier = suppliers.reduce<Record<string, number>>(
    (pools, supplier) => {
      pools[supplier.id] = Math.max(
        0,
        (totalSupplierPaymentsBySupplier[supplier.id] ?? 0) -
          (explicitSupplierAllocationsBySupplier[supplier.id] ?? 0)
      );
      return pools;
    },
    {}
  );
  const supplierPaymentAllocationByPurchaseTransaction = purchaseTransactions
    .slice()
    .sort((a, b) => {
      const aDate = getDateOnly(a.created_at) ?? "";
      const bDate = getDateOnly(b.created_at) ?? "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .reduce<Record<string, SupplierPurchasePaymentAllocation>>((allocations, transaction) => {
      const purchaseTotal = purchaseInvoiceTotalsByTransaction[transaction.id] ?? 0;
      const explicitAllocatedAmount = Math.max(
        0,
        supplierAllocatedAmountsByPurchaseTransaction[transaction.id] ?? 0
      );
      const remainingAfterExplicitAllocation = Math.max(0, purchaseTotal - explicitAllocatedAmount);
      const availableLegacyPool = legacySupplierPaymentPoolBySupplier[transaction.supplier_id] ?? 0;
      const fallbackAllocatedAmount = Math.min(
        availableLegacyPool,
        remainingAfterExplicitAllocation
      );

      legacySupplierPaymentPoolBySupplier[transaction.supplier_id] = Math.max(
        0,
        availableLegacyPool - fallbackAllocatedAmount
      );
      allocations[transaction.id] = {
        purchaseTotal,
        explicitAllocatedAmount,
        fallbackAllocatedAmount,
        paidAmount: explicitAllocatedAmount + fallbackAllocatedAmount,
        remainingPayableAmount: Math.max(
          0,
          remainingAfterExplicitAllocation - fallbackAllocatedAmount
        ),
      };
      return allocations;
    }, {});
  const remainingLegacySupplierPaymentPoolBySupplier = { ...legacySupplierPaymentPoolBySupplier };
  const unpaidPurchaseInvoicesForSelectedPaymentSupplier: Array<{
    transaction: PurchaseTransaction;
    supplier: Supplier | undefined;
    purchaseTotal: number;
    explicitAllocatedAmount: number;
    fallbackAllocatedAmount: number;
    allocatedAmount: number;
    remainingPayableAmount: number;
    purchaseDate: string | null;
  }> = purchaseTransactions
    .filter((transaction) => transaction.supplier_id === selectedSupplierPaymentId)
    .map((transaction) => {
      const allocation = supplierPaymentAllocationByPurchaseTransaction[transaction.id];
      const purchaseTotal = allocation?.purchaseTotal ?? purchaseInvoiceTotalsByTransaction[transaction.id] ?? 0;
      const explicitAllocatedAmount = allocation?.explicitAllocatedAmount ?? 0;
      const fallbackAllocatedAmount = allocation?.fallbackAllocatedAmount ?? 0;
      const allocatedAmount = allocation?.paidAmount ?? explicitAllocatedAmount;
      const remainingPayableAmount = Math.max(0, allocation?.remainingPayableAmount ?? 0);
      return {
        transaction,
        supplier: suppliers.find((supplier) => supplier.id === transaction.supplier_id),
        purchaseTotal,
        explicitAllocatedAmount,
        fallbackAllocatedAmount,
        allocatedAmount,
        remainingPayableAmount,
        purchaseDate: getDateOnly(transaction.created_at),
      };
    })
    .filter((invoice) => invoice.remainingPayableAmount > 0)
    .sort((a, b) => {
      const aDate = a.purchaseDate ?? "";
      const bDate = b.purchaseDate ?? "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return new Date(a.transaction.created_at).getTime() - new Date(b.transaction.created_at).getTime();
    });
  const supplierPaymentAllocationTotal = Object.values(supplierPaymentAllocationsByInvoice).reduce(
    (sum, value) => sum + safeNumber(value),
    0
  );
  const supplierPaymentAmountValue = safeNumber(supplierPaymentAmount);
  const supplierPaymentUnallocatedAmount = Math.max(
    0,
    (Number.isFinite(supplierPaymentAmountValue) ? supplierPaymentAmountValue : 0) -
      supplierPaymentAllocationTotal
  );
  const supplierPaymentHistory: Array<{
    payment: any;
    supplier: Supplier | undefined;
    paymentAmount: number;
    allocations: Array<{
      allocation: any;
      transaction: PurchaseTransaction | undefined;
      amount: number;
    }>;
    explicitlyAllocatedAmount: number;
    unallocatedAmount: number;
    allocationExceedsPayment: boolean;
  }> = supplierPayments
    .map((payment) => {
      const paymentId = String(payment.id ?? "");
      const paymentAmount = safeNumber(payment.amount);
      const allocations = supplierPaymentAllocations
        .filter((allocation) => String(allocation.supplier_payment_id ?? "") === paymentId)
        .map((allocation) => {
          const transaction = purchaseTransactionsById[String(allocation.purchase_transaction_id ?? "")];
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
        supplier: suppliers.find((supplier) => supplier.id === payment.supplier_id),
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
  const explicitSupplierAllocationsByPayment =
    supplierPaymentAllocations.reduce<Record<string, number>>((totals, allocation) => {
      const paymentId = String(allocation.supplier_payment_id ?? "");
      if (!paymentId) return totals;
      totals[paymentId] = (totals[paymentId] ?? 0) + safeNumber(allocation.amount);
      return totals;
    }, {});

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
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoValue = toDateInputValue(thirtyDaysAgo);
  const salesTransactionsByIdForReorder = salesTransactions.reduce<Record<string, SalesTransaction>>(
    (transactions, transaction) => {
      transactions[transaction.id] = transaction;
      return transactions;
    },
    {}
  );
  const reorderStatusRank: Record<string, number> = {
    "Out of Stock": 0,
    "Urgent Reorder": 1,
    "Low Stock Soon": 2,
    Healthy: 3,
  };
  const reorderRecommendations = products
    .map((product) => {
      const productId = String(product.id);
      const brand = brands.find((item) => item.id === product.brand_id);
      const category = categories.find((item) => item.id === product.category_id);
      const purchasedQty = filteredPurchaseItems
        .filter((item) => String(item.product_id) === productId)
        .reduce((sum, item) => sum + safeNumber(item.quantity), 0);
      const soldQty = filteredSalesItems
        .filter((item) => String(item.product_id) === productId)
        .reduce((sum, item) => sum + safeNumber(item.quantity), 0);
      const currentStock = purchasedQty - soldQty;
      const reorderLevel = safeNumber(product.reorder_level ?? product.minimum_stock_level ?? 0);
      const recentSalesQuantity = filteredSalesItems
        .filter((item) => {
          if (String(item.product_id) !== productId) return false;
          const transaction = salesTransactionsByIdForReorder[String(item.sales_transaction_id ?? "")];
          const saleDate = getDateOnly(transaction?.sale_date);
          return Boolean(saleDate && saleDate >= thirtyDaysAgoValue && saleDate <= todayDateValue);
        })
        .reduce((sum, item) => sum + safeNumber(item.quantity), 0);
      const dailyAverageSales = recentSalesQuantity / 30;
      const estimatedDaysLeft =
        dailyAverageSales > 0 ? currentStock / dailyAverageSales : null;
      const suggestedReorderQuantity =
        reorderLevel > 0 ? Math.max(reorderLevel * 2 - currentStock, 0) : 0;
      const status =
        currentStock <= 0
          ? "Out of Stock"
          : currentStock <= reorderLevel
            ? "Urgent Reorder"
            : dailyAverageSales > 0 && estimatedDaysLeft !== null && estimatedDaysLeft <= 7
              ? "Low Stock Soon"
              : "Healthy";

      return {
        productId,
        productName: product.name,
        brandName: brand?.name ?? "",
        categoryName: category?.name ?? "",
        unitType: product.unit_type ?? "units",
        purchasedQty,
        soldQty,
        currentStock,
        reorderLevel,
        recentSalesQuantity,
        dailyAverageSales,
        estimatedDaysLeft,
        suggestedReorderQuantity,
        status,
        missingReorderLevel: reorderLevel <= 0,
      };
    })
    .sort((a, b) => {
      const statusDifference = reorderStatusRank[a.status] - reorderStatusRank[b.status];
      if (statusDifference !== 0) return statusDifference;
      return a.currentStock - b.currentStock;
    });
  const reorderRecommendationSummary = reorderRecommendations.reduce(
    (summary, recommendation) => {
      if (recommendation.status === "Out of Stock") summary.outOfStockCount += 1;
      if (recommendation.status === "Urgent Reorder") summary.urgentReorderCount += 1;
      if (recommendation.status === "Low Stock Soon") summary.lowStockSoonCount += 1;
      if (recommendation.missingReorderLevel) summary.missingReorderLevelCount += 1;
      return summary;
    },
    {
      outOfStockCount: 0,
      urgentReorderCount: 0,
      lowStockSoonCount: 0,
      missingReorderLevelCount: 0,
    }
  );
  const filteredReorderRecommendations = reorderRecommendations.filter((recommendation) => {
    const matchesFilter =
      reorderRecommendationFilter === "all" ||
      (reorderRecommendationFilter === "missing-reorder-level" &&
        recommendation.missingReorderLevel) ||
      recommendation.status === reorderRecommendationFilter;
    const searchTerm = reorderRecommendationSearch.trim().toLowerCase();
    const matchesSearch =
      !searchTerm ||
      [recommendation.productName, recommendation.brandName, recommendation.categoryName].some(
        (value) => value.toLowerCase().includes(searchTerm)
      );
    return matchesFilter && matchesSearch;
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

    const totalPurchases = supplierTxIds.reduce(
      (sum, transactionId) =>
        sum + (supplierPaymentAllocationByPurchaseTransaction[transactionId]?.purchaseTotal ?? 0),
      0
    );
    const paymentsMade = totalSupplierPaymentsBySupplier[supplier.id] ?? 0;
    const remainingPayable = supplierTxIds.reduce(
      (sum, transactionId) =>
        sum +
        Math.max(
          0,
          supplierPaymentAllocationByPurchaseTransaction[transactionId]?.remainingPayableAmount ?? 0
        ),
      0
    );

    return {
      supplierId: supplier.id,
      supplierName: supplier.supplier_name,
      totalPurchases,
      paymentsMade,
      remainingPayable,
    };
  });
  const selectedSupplierLedgerPurchaseTransactions = purchaseTransactions.filter(
    (transaction) => transaction.supplier_id === selectedSupplierLedgerId
  );
  const selectedSupplierLedgerPayments = supplierPayments.filter(
    (payment) => payment.supplier_id === selectedSupplierLedgerId
  );
  const supplierLedgerRawEntries: SupplierLedgerEntry[] = [
    ...selectedSupplierLedgerPurchaseTransactions.map((transaction) => {
      const timestamp = getUsableTimestamp(transaction.purchase_date, transaction.created_at);
      return {
        id: `purchase-${transaction.id}`,
        date: getDateOnly(timestamp.value),
        eventTimestamp: timestamp.value,
        eventTime: timestamp.time,
        eventType: "purchase" as const,
        reference: `Purchase invoice ${transaction.invoice_number}`,
        notes: "Purchase invoice",
        debit: supplierPaymentAllocationByPurchaseTransaction[transaction.id]?.purchaseTotal ?? 0,
        credit: 0,
      };
    }),
    ...selectedSupplierLedgerPayments.map((payment) => {
      const timestamp = getUsableTimestamp(payment.payment_date, payment.created_at);
      const paymentId = String(payment.id ?? "");
      const unallocatedAmount = Math.max(
        0,
        safeNumber(payment.amount) - (explicitSupplierAllocationsByPayment[paymentId] ?? 0)
      );
      const paymentNotes = [payment.notes, unallocatedAmount > 0 ? "Unallocated payment" : ""]
        .filter(Boolean)
        .join(" - ");

      return {
        id: `payment-${paymentId}`,
        date: getDateOnly(timestamp.value),
        eventTimestamp: timestamp.value,
        eventTime: timestamp.time,
        eventType: "payment" as const,
        reference: "Supplier payment",
        notes: paymentNotes,
        debit: 0,
        credit: safeNumber(payment.amount),
      };
    }),
  ];
  const supplierLedgerEntriesInDateRange = supplierLedgerRawEntries
    .filter((entry) => isDateInRange(entry.date, supplierLedgerStartDate, supplierLedgerEndDate))
    .sort((a, b) => {
      if (a.eventTime !== b.eventTime) return a.eventTime - b.eventTime;
      if (a.eventType !== b.eventType) return a.eventType === "purchase" ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
  const supplierLedgerTotalPurchases = supplierLedgerEntriesInDateRange.reduce(
    (sum, entry) => sum + entry.debit,
    0
  );
  const supplierLedgerTotalPayments = supplierLedgerEntriesInDateRange.reduce(
    (sum, entry) => sum + entry.credit,
    0
  );
  const supplierLedgerCurrentBalance = supplierLedgerTotalPurchases - supplierLedgerTotalPayments;
  const supplierLedgerUnallocatedPayments = selectedSupplierLedgerPayments
    .filter((payment) =>
      isDateInRange(
        getDateOnly(getUsableTimestamp(payment.payment_date, payment.created_at).value),
        supplierLedgerStartDate,
        supplierLedgerEndDate
      )
    )
    .reduce((sum, payment) => {
      const paymentId = String(payment.id ?? "");
      return (
        sum +
        Math.max(
          0,
          safeNumber(payment.amount) - (explicitSupplierAllocationsByPayment[paymentId] ?? 0)
        )
      );
    }, 0);
  const supplierLedgerEntries: SupplierLedgerDisplayEntry[] = supplierLedgerEntriesInDateRange
    .reduce<SupplierLedgerDisplayEntry[]>((entries, entry) => {
      const previousBalance = entries[entries.length - 1]?.runningBalance ?? 0;
      entries.push({
        id: entry.id,
        date: entry.date,
        eventTimestamp: entry.eventTimestamp,
        eventTime: entry.eventTime,
        eventType: entry.eventType,
        reference: entry.reference,
        notes: entry.notes,
        debit: Math.max(0, entry.debit),
        credit: Math.max(0, entry.credit),
        runningBalance: previousBalance + entry.debit - entry.credit,
      });
      return entries;
    }, []);

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
  const handleSupplierLedgerStartDateChange = (value: string) => {
    setSupplierLedgerStartDate(value);
    if (value && supplierLedgerEndDate && supplierLedgerEndDate < value) {
      setSupplierLedgerEndDate(value);
    }
    setSupplierLedgerDateError(null);
  };
  const handleSupplierLedgerEndDateChange = (value: string) => {
    if (supplierLedgerStartDate && value && value < supplierLedgerStartDate) {
      setSupplierLedgerDateError("End Date cannot be earlier than Start Date.");
      return;
    }
    setSupplierLedgerEndDate(value);
    setSupplierLedgerDateError(null);
  };
  const applySupplierLedgerMonthRange = (monthOffset: number) => {
    const range = getMonthRange(monthOffset);
    setSupplierLedgerStartDate(range.start);
    setSupplierLedgerEndDate(range.end);
    setSupplierLedgerDateError(null);
  };
  const applySupplierLedgerAllTime = () => {
    setSupplierLedgerStartDate("");
    setSupplierLedgerEndDate("");
    setSupplierLedgerDateError(null);
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

  const resetTaskForm = () => {
    setTaskTitle("");
    setTaskType("general");
    setTaskPriority("medium");
    setTaskStatus("pending");
    setTaskDueDate("");
    setTaskNotes("");
    setSelectedTaskCustomerId("");
    setSelectedTaskSupplierId("");
    setSelectedTaskProductId("");
    setSelectedTaskPurchaseId("");
    setSelectedTaskSaleId("");
  };

  const getTaskRelations = () => {
    const customerId = customers.some((customer) => customer.id === selectedTaskCustomerId)
      ? selectedTaskCustomerId
      : null;
    const supplierId = suppliers.some((supplier) => supplier.id === selectedTaskSupplierId)
      ? selectedTaskSupplierId
      : null;
    const purchaseTransactionId = purchaseTransactions.some(
      (transaction) => transaction.id === selectedTaskPurchaseId
    )
      ? selectedTaskPurchaseId
      : null;
    const salesTransactionId = salesTransactions.some(
      (transaction) => transaction.id === selectedTaskSaleId
    )
      ? selectedTaskSaleId
      : null;
    const product = products.find((item) => String(item.id) === selectedTaskProductId);

    return {
      customerId,
      supplierId,
      productId: product ? product.id : null,
      purchaseTransactionId,
      salesTransactionId,
    };
  };

  const saveTask = async () => {
    setTaskMessage(null);
    setTaskError(null);

    const trimmedTitle = taskTitle.trim();
    if (!trimmedTitle) {
      setTaskError("Task title is required.");
      return;
    }

    if (!requireOrganization("create task")) {
      setTaskError("Organization not loaded. Please login again.");
      return;
    }

    if (taskDueDate && Number.isNaN(new Date(`${taskDueDate}T00:00:00`).getTime())) {
      setTaskError("Please enter a valid due date.");
      return;
    }

    const relations = getTaskRelations();
    setTaskLoading(true);

    try {
      const { data, error } = await supabase.from("tasks").insert({
        organization_id: currentOrganizationId,
        title: trimmedTitle,
        task_type: taskTypes.includes(taskType) ? taskType : "general",
        priority: taskPriorities.includes(taskPriority) ? taskPriority : "medium",
        status: taskStatuses.includes(taskStatus) ? taskStatus : "pending",
        due_date: taskDueDate || null,
        notes: taskNotes.trim() || null,
        customer_id: relations.customerId,
        supplier_id: relations.supplierId,
        product_id: relations.productId,
        purchase_transaction_id: relations.purchaseTransactionId,
        sales_transaction_id: relations.salesTransactionId,
        completed_at: taskStatus === "completed" ? new Date().toISOString() : null,
      }).select("id").single();

      if (error) {
        console.error("Supabase task insert error:", JSON.stringify(error, null, 2));
        setTaskError(`Failed to save task: ${JSON.stringify(error, null, 2)}`);
        return;
      }

      await createAuditLog({
        action: taskStatus === "completed" ? "completed" : "created",
        entity_type: "task",
        entity_id: data?.id ?? null,
        entity_label: trimmedTitle,
        description:
          taskStatus === "completed"
            ? `Completed task ${trimmedTitle}`
            : `Created task ${trimmedTitle}`,
        new_values: {
          title: trimmedTitle,
          task_type: taskType,
          priority: taskPriority,
          status: taskStatus,
          due_date: taskDueDate || null,
          notes: taskNotes.trim() || null,
          ...relations,
        },
      });
      setTaskMessage("Task saved successfully.");
      resetTaskForm();
      await fetchTasks(currentOrganizationId);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Failed to save task.");
      console.error("Error saving task:", err);
    } finally {
      setTaskLoading(false);
    }
  };

  const updateTaskStatus = async (taskId: string, nextStatus: "in_progress" | "completed" | "cancelled") => {
    setTaskMessage(null);
    setTaskError(null);

    if (!requireOrganization("update task status")) {
      setTaskError("Organization not loaded. Please login again.");
      return;
    }

    const taskToUpdate = tasks.find((task) => task.id === taskId);
    const completedAt = nextStatus === "completed" ? new Date().toISOString() : null;
    const { error } = await supabase
      .from("tasks")
      .update({
        status: nextStatus,
        completed_at: completedAt,
      })
      .eq("id", taskId)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase task status update error:", JSON.stringify(error, null, 2));
      setTaskError(`Failed to update task: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: nextStatus === "completed" ? "completed" : nextStatus === "cancelled" ? "cancelled" : "updated",
      entity_type: "task",
      entity_id: taskId,
      entity_label: taskToUpdate?.title ?? taskId,
      description:
        nextStatus === "completed"
          ? `Completed task ${taskToUpdate?.title ?? taskId}`
          : nextStatus === "cancelled"
            ? `Cancelled task ${taskToUpdate?.title ?? taskId}`
            : `Marked task ${taskToUpdate?.title ?? taskId} in progress`,
      old_values: taskToUpdate
        ? { status: taskToUpdate.status, completed_at: taskToUpdate.completed_at }
        : null,
      new_values: {
        status: nextStatus,
        completed_at: completedAt,
      },
    });
    setTaskMessage(`Task marked ${taskStatusLabels[nextStatus].toLowerCase()}.`);
    await fetchTasks(currentOrganizationId);
  };

  const taskMatchesRelation = (
    task: Task,
    relation: {
      customer_id?: string | null;
      supplier_id?: string | null;
      purchase_transaction_id?: string | null;
      sales_transaction_id?: string | null;
      product_id?: number | string | null;
    }
  ) =>
    (!relation.customer_id || task.customer_id === relation.customer_id) &&
    (!relation.supplier_id || task.supplier_id === relation.supplier_id) &&
    (!relation.purchase_transaction_id || task.purchase_transaction_id === relation.purchase_transaction_id) &&
    (!relation.sales_transaction_id || task.sales_transaction_id === relation.sales_transaction_id) &&
    (relation.product_id == null || String(task.product_id ?? "") === String(relation.product_id));

  const activeTasks = tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  const hasActiveTask = (
    title: string,
    relation: Parameters<typeof taskMatchesRelation>[1]
  ) =>
    activeTasks.some(
      (task) =>
        task.title.trim().toLowerCase() === title.trim().toLowerCase() &&
        taskMatchesRelation(task, relation)
    );

  const taskSuggestions: TaskSuggestion[] = [
    ...salesTransactions
      .filter((transaction) => transaction.payment_type === "credit")
      .map((transaction) => {
        const allocation = creditAllocationByTransaction[transaction.id];
        const remainingUnpaidAmount = allocation?.remainingUnpaidAmount ?? 0;
        const dueDate = getDateOnly(transaction.credit_due_date);
        const customer = customers.find((item) => item.id === transaction.customer_id);
        if (!dueDate || dueDate >= todayDateValue || remainingUnpaidAmount <= 0) return null;
        const title = `Collect overdue payment from ${customer?.customer_name ?? "Unknown Customer"}`;
        const relation = {
          customer_id: transaction.customer_id,
          sales_transaction_id: transaction.id,
        };
        if (hasActiveTask(title, relation)) return null;
        return {
          key: `overdue-${transaction.id}`,
          title,
          reason: `Invoice ${transaction.invoice_number} is overdue with ${formatPKR(remainingUnpaidAmount)} remaining.`,
          task_type: "payment_collection",
          priority: "urgent",
          customer_id: transaction.customer_id,
          supplier_id: null,
          product_id: null,
          purchase_transaction_id: null,
          sales_transaction_id: transaction.id,
        };
      }),
    ...purchaseTransactions
      .filter((transaction) =>
        ["pending", "review_later", null].includes(transaction.expense_review_status as any)
      )
      .map((transaction) => {
        const supplier = suppliers.find((item) => item.id === transaction.supplier_id);
        const title = `Review purchase expenses for invoice ${transaction.invoice_number}`;
        const relation = {
          supplier_id: transaction.supplier_id,
          purchase_transaction_id: transaction.id,
        };
        if (hasActiveTask(title, relation)) return null;
        return {
          key: `expense-review-${transaction.id}`,
          title,
          reason: `Purchase invoice ${transaction.invoice_number} needs expense review.`,
          task_type: "expense_review",
          priority: "medium",
          customer_id: null,
          supplier_id: supplier?.id ?? transaction.supplier_id,
          product_id: null,
          purchase_transaction_id: transaction.id,
          sales_transaction_id: null,
        };
      }),
    ...reorderRecommendations
      .filter((recommendation) =>
        recommendation.status === "Out of Stock" || recommendation.status === "Urgent Reorder"
      )
      .map((recommendation) => {
        const title = `Prepare reorder for ${recommendation.productName}`;
        const relation = { product_id: recommendation.productId };
        if (hasActiveTask(title, relation)) return null;
        return {
          key: `reorder-${recommendation.productId}`,
          title,
          reason:
            recommendation.status === "Out of Stock"
              ? "Product is out of stock."
              : "Product is at or below reorder level.",
          task_type: "reorder",
          priority: recommendation.status === "Out of Stock" ? "urgent" : "high",
          customer_id: null,
          supplier_id: null,
          product_id: recommendation.productId,
          purchase_transaction_id: null,
          sales_transaction_id: null,
        };
      }),
  ].filter(Boolean) as TaskSuggestion[];

  const createTaskFromSuggestion = async (suggestion: (typeof taskSuggestions)[number]) => {
    if (!requireOrganization("create suggested task")) {
      setTaskError("Organization not loaded. Please login again.");
      return;
    }

    setTaskMessage(null);
    setTaskError(null);
    setTaskLoading(true);

    try {
      const { data, error } = await supabase.from("tasks").insert({
        organization_id: currentOrganizationId,
        title: suggestion.title,
        task_type: suggestion.task_type,
        priority: suggestion.priority,
        status: "pending",
        due_date: null,
        notes: suggestion.reason,
        customer_id: suggestion.customer_id,
        supplier_id: suggestion.supplier_id,
        product_id: suggestion.product_id,
        purchase_transaction_id: suggestion.purchase_transaction_id,
        sales_transaction_id: suggestion.sales_transaction_id,
        completed_at: null,
      }).select("id").single();

      if (error) {
        console.error("Supabase suggested task insert error:", JSON.stringify(error, null, 2));
        setTaskError(`Failed to create suggested task: ${JSON.stringify(error, null, 2)}`);
        return;
      }

      await createAuditLog({
        action: "created",
        entity_type: "task",
        entity_id: data?.id ?? null,
        entity_label: suggestion.title,
        description: `Created task ${suggestion.title}`,
        new_values: {
          title: suggestion.title,
          task_type: suggestion.task_type,
          priority: suggestion.priority,
          status: "pending",
          notes: suggestion.reason,
          customer_id: suggestion.customer_id,
          supplier_id: suggestion.supplier_id,
          product_id: suggestion.product_id,
          purchase_transaction_id: suggestion.purchase_transaction_id,
          sales_transaction_id: suggestion.sales_transaction_id,
        },
      });
      setTaskMessage("Suggested task created.");
      await fetchTasks(currentOrganizationId);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Failed to create suggested task.");
      console.error("Error creating suggested task:", err);
    } finally {
      setTaskLoading(false);
    }
  };

  const taskDashboardSummary = tasks.reduce(
    (summary, task) => {
      const dueDate = getDateOnly(task.due_date);
      const active = task.status !== "completed" && task.status !== "cancelled";
      if (task.status === "pending") summary.pending += 1;
      if (active && dueDate && dueDate < todayDateValue) summary.overdue += 1;
      if (active && dueDate === todayDateValue) summary.dueToday += 1;
      if (task.priority === "urgent" && active) summary.urgent += 1;
      return summary;
    },
    { pending: 0, overdue: 0, dueToday: 0, urgent: 0 }
  );

  const nextDashboardTasks = tasks
    .filter((task) => task.status === "pending" || task.status === "in_progress")
    .slice()
    .sort((a, b) => {
      const aDueDate = getDateOnly(a.due_date) ?? "9999-12-31";
      const bDueDate = getDateOnly(b.due_date) ?? "9999-12-31";
      if (aDueDate !== bDueDate) return aDueDate.localeCompare(bDueDate);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
    .slice(0, 5);

  const filteredTasks = tasks.filter((task) => {
    const dueDate = getDateOnly(task.due_date);
    const active = task.status !== "completed" && task.status !== "cancelled";
    const matchesFilter =
      taskFilter === "all" ||
      task.status === taskFilter ||
      (taskFilter === "overdue" && active && Boolean(dueDate && dueDate < todayDateValue)) ||
      (taskFilter === "due_today" && active && dueDate === todayDateValue) ||
      (taskFilter === "high_urgent" && (task.priority === "high" || task.priority === "urgent"));

    if (!matchesFilter) return false;

    const customer = customers.find((item) => item.id === task.customer_id);
    const supplier = suppliers.find((item) => item.id === task.supplier_id);
    const product = products.find((item) => String(item.id) === String(task.product_id));
    const searchTerm = taskSearch.trim().toLowerCase();
    if (!searchTerm) return true;

    return [
      task.title,
      task.notes ?? "",
      customer?.customer_name ?? "",
      supplier?.supplier_name ?? "",
      product?.name ?? "",
    ].some((value) => value.toLowerCase().includes(searchTerm));
  });

  const auditLogEntityTypes = Array.from(new Set(auditLogs.map((log) => log.entity_type).filter(Boolean))).sort();
  const auditLogActions = Array.from(new Set(auditLogs.map((log) => log.action).filter(Boolean))).sort();
  const todayAuditDate = todayDateValue;
  const filteredAuditLogs = auditLogs.filter((log) => {
    const logDate = getDateOnly(log.created_at);
    if (auditLogEntityFilter !== "all" && log.entity_type !== auditLogEntityFilter) return false;
    if (auditLogActionFilter !== "all" && log.action !== auditLogActionFilter) return false;
    if (auditLogDateFrom && logDate && logDate < auditLogDateFrom) return false;
    if (auditLogDateTo && logDate && logDate > auditLogDateTo) return false;

    const searchTerm = auditLogSearch.trim().toLowerCase();
    if (!searchTerm) return true;

    return [
      log.action,
      log.entity_type,
      log.entity_label ?? "",
      log.description ?? "",
      log.actor_email ?? "",
    ].some((value) => value.toLowerCase().includes(searchTerm));
  });
  const auditLogSummary = auditLogs.reduce(
    (summary, log) => {
      const logDate = getDateOnly(log.created_at);
      summary.total += 1;
      if (logDate === todayAuditDate) summary.today += 1;
      if (log.action === "created") summary.creates += 1;
      if (log.action === "updated" || log.action === "deleted") summary.updatesDeletes += 1;
      return summary;
    },
    { total: 0, today: 0, creates: 0, updatesDeletes: 0 }
  );
  const recentAuditLogs = auditLogs.slice(0, 5);
  const securityChecksByKey = new Map(securityChecks.map((check) => [check.check_key, check]));
  const displayedSecurityChecks = defaultSecurityChecks.map((defaultCheck) => {
    const savedCheck = securityChecksByKey.get(defaultCheck.key);
    return {
      id: savedCheck?.id,
      organization_id: savedCheck?.organization_id ?? currentOrganizationId ?? "",
      check_key: defaultCheck.key,
      check_label: savedCheck?.check_label ?? defaultCheck.label,
      status: savedCheck?.status ?? "pending",
      notes: savedCheck?.notes ?? null,
      checked_at: savedCheck?.checked_at ?? null,
      checked_by_profile_id: savedCheck?.checked_by_profile_id ?? null,
    } as SecurityCheck;
  });
  const securityCheckSummary = displayedSecurityChecks.reduce(
    (summary, check) => {
      summary.total += 1;
      if (check.status === "pass") summary.passed += 1;
      else if (check.status === "fail") summary.failed += 1;
      else summary.pending += 1;
      return summary;
    },
    { total: 0, passed: 0, pending: 0, failed: 0 }
  );
  const allSecurityChecksPassed =
    securityCheckSummary.total > 0 &&
    securityCheckSummary.passed === securityCheckSummary.total;
  const businessSettingsComplete = Boolean(
    (currentOrganization?.name ?? currentProfile?.organization_name ?? organizationName).trim() &&
      (String(currentOrganization?.phone ?? "").trim() || String(currentOrganization?.address ?? "").trim())
  );
  const deploymentEnvironmentChecks = [
    {
      key: "supabase_url",
      label: "Supabase project URL configured",
      status: currentUser ? "pass" : "info",
      detail: currentUser
        ? "Configured locally if the app is running."
        : "Configured locally if the app is running.",
    },
    {
      key: "supabase_anon_key",
      label: "Supabase anon key configured",
      status: currentUser ? "pass" : "info",
      detail: currentUser
        ? "Configured locally if the app is running."
        : "Configured locally if the app is running.",
    },
    {
      key: "organization_loaded",
      label: "Organization loads successfully",
      status: currentOrganizationId ? "pass" : "warning",
      detail: currentOrganizationId ? "Organization ID is loaded." : "Login and profile loading required.",
    },
    {
      key: "profile_loaded",
      label: "Current user profile loads successfully",
      status: currentProfile ? "pass" : "warning",
      detail: currentProfile ? "Current profile is loaded." : "Current profile is not loaded.",
    },
    {
      key: "business_settings",
      label: "Business name, phone, and address added",
      status: businessSettingsComplete ? "pass" : "warning",
      detail: businessSettingsComplete
        ? "Business branding data is present."
        : "Add business name and at least phone or address.",
    },
    {
      key: "rls_security",
      label: "RLS security readiness completed",
      status: allSecurityChecksPassed || securityChecks.length > 0 ? "pass" : "warning",
      detail:
        allSecurityChecksPassed || securityChecks.length > 0
          ? "Security readiness is being tracked."
          : "Open Security Check and complete final testing.",
    },
    {
      key: "staff_permissions",
      label: "Staff roles and permissions available",
      status: Array.isArray(staffPermissions) ? "pass" : "warning",
      detail: "Staff permissions feature is available.",
    },
    {
      key: "print_export",
      label: "Print invoices and CSV exports available",
      status: "pass",
      detail: "Print and export tools are built into TradeOS.",
    },
    {
      key: "production_build",
      label: "Run npm.cmd run build before deployment",
      status: "manual",
      detail: "Manual check required before each deployment.",
    },
    {
      key: "vercel_env",
      label: "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel",
      status: "manual",
      detail: "Add variables in Vercel without exposing secret values.",
    },
  ];
  const deploymentPassedCount = deploymentEnvironmentChecks.filter((check) => check.status === "pass").length;
  const deploymentWarningCount = deploymentEnvironmentChecks.filter((check) => check.status === "warning").length;
  const deploymentManualCount = deploymentEnvironmentChecks.filter((check) => check.status === "manual").length;
  const deploymentManualCompletedCount = deploymentManualChecklistItems.filter(
    (item) => deploymentChecklistState[item]
  ).length;

  const organizationDisplayName =
    (currentOrganization?.name ?? currentProfile?.organization_name ?? organizationName).trim() ||
    "Organization";
  const businessPhone = String(currentOrganization?.phone ?? "").trim();
  const businessAddress = String(currentOrganization?.address ?? "").trim();
  const businessCity = String(currentOrganization?.city ?? "").trim();
  const businessFooterNote = String(currentOrganization?.invoice_footer_note ?? "").trim();
  const businessDefaultPaymentTerms = String(currentOrganization?.default_payment_terms ?? "").trim();
  const businessAddressLine = [businessAddress, businessCity].filter(Boolean).join(", ");
  const businessBrandingHtml = () =>
    `<h1>${escapeHtml(organizationDisplayName)}</h1>
      ${businessPhone ? `<p class="muted">Phone: ${escapeHtml(businessPhone)}</p>` : ""}
      ${businessAddressLine ? `<p class="muted">${escapeHtml(businessAddressLine)}</p>` : ""}`;
  const businessPrintFooterHtml = () =>
    `${businessDefaultPaymentTerms ? `<p><strong>Payment Terms:</strong> ${escapeHtml(businessDefaultPaymentTerms)}</p>` : ""}
      ${businessFooterNote ? `<p>${escapeHtml(businessFooterNote)}</p>` : ""}
      <p class="footer">Generated by TradeOS</p>`;

  const renderRows = (rows: string[][]) =>
    rows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
      )
      .join("");

  const renderHeaderRows = (headers: string[]) =>
    `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;

  const openPrintPreview = (title: string, html: string) => {
    if (!html.trim()) return;
    setPrintPreviewTitle(title.trim() || "Print Preview");
    setPrintPreviewHtml(html);
    setIsPrintPreviewOpen(true);
  };

  const handlePrintSalesInvoice = (transaction: SalesTransaction) => {
    const customer = customers.find((item) => item.id === transaction.customer_id);
    const lineItems = salesItems.filter((item) => item.sales_transaction_id === transaction.id);
    const creditAllocation = creditAllocationByTransaction[transaction.id];
    const invoiceTotal =
      creditAllocation?.invoiceTotal ??
      lineItems.reduce(
        (sum, item) => sum + safeNumber(item.quantity) * safeNumber(item.selling_price),
        0
      );
    const lineRows =
      lineItems.length === 0
        ? [["No line items found", "-", formatPKR(0), formatPKR(0)]]
        : lineItems.map((item) => {
            const product = products.find((productItem) => String(productItem.id) === String(item.product_id));
            const quantity = safeNumber(item.quantity);
            const sellingPrice = safeNumber(item.selling_price);
            return [
              product?.name ?? "Unknown Product",
              String(quantity),
              formatPKR(sellingPrice),
              formatPKR(quantity * sellingPrice),
            ];
          });

    openPrintPreview(
      `Sales Invoice ${transaction.invoice_number}`,
      `${businessBrandingHtml()}
      <h2>Sales Invoice</h2>
      <div class="grid">
        <div><strong>Invoice:</strong> ${escapeHtml(transaction.invoice_number)}</div>
        <div><strong>Sale Date:</strong> ${escapeHtml(formatDate(transaction.sale_date ?? transaction.created_at))}</div>
        <div><strong>Customer:</strong> ${escapeHtml(customer?.customer_name ?? "Unknown Customer")}</div>
        <div><strong>Payment Type:</strong> ${escapeHtml(transaction.payment_type === "credit" ? "Credit" : "Cash")}</div>
        ${
          transaction.credit_due_date
            ? `<div><strong>Credit Due Date:</strong> ${escapeHtml(formatDate(transaction.credit_due_date))}</div>`
            : ""
        }
      </div>
      <table>
        <thead>${renderHeaderRows(["Product", "Quantity", "Selling Price", "Line Total"])}</thead>
        <tbody>${renderRows(lineRows)}</tbody>
      </table>
      <div class="summary">
        <p><strong>Grand Total:</strong> ${escapeHtml(formatPKR(invoiceTotal))}</p>
        ${
          transaction.payment_type === "credit"
            ? `<p><strong>Remaining Balance:</strong> ${escapeHtml(formatPKR(creditAllocation?.remainingUnpaidAmount ?? 0))}</p>`
            : ""
        }
      </div>
      ${businessPrintFooterHtml()}`
    );
  };

  const handlePrintPurchaseInvoice = (transaction: PurchaseTransaction) => {
    const supplier = suppliers.find((item) => item.id === transaction.supplier_id);
    const lineItems = purchaseItems.filter((item) => item.purchase_transaction_id === transaction.id);
    const linkedPurchaseExpenses = expenses.filter(
      (expense) => expense.purchase_transaction_id === transaction.id
    );
    const purchaseValue = lineItems.reduce(
      (sum, item) => sum + safeNumber(item.quantity) * safeNumber(item.purchase_price),
      0
    );
    const linkedExpenseTotal = linkedPurchaseExpenses.reduce(
      (sum, expense) => sum + safeNumber(expense.amount),
      0
    );
    const landedInvoiceCost = purchaseValue + linkedExpenseTotal;
    const paymentSummary = supplierPaymentAllocationByPurchaseTransaction[transaction.id];
    const remainingPayable = Math.max(
      0,
      paymentSummary?.remainingPayableAmount ?? paymentSummary?.purchaseTotal ?? purchaseValue
    );
    const paidAmount = paymentSummary?.paidAmount ?? 0;
    const paymentStatus =
      remainingPayable <= 0 ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid";
    const lineRows =
      lineItems.length === 0
        ? [["No line items found", "-", formatPKR(0), formatPKR(0), "-", "-"]]
        : lineItems.map((item) => {
            const product = products.find((productItem) => String(productItem.id) === String(item.product_id));
            const quantity = safeNumber(item.quantity);
            const purchasePrice = safeNumber(item.purchase_price);
            return [
              product?.name ?? "Unknown Product",
              String(quantity),
              formatPKR(purchasePrice),
              formatPKR(quantity * purchasePrice),
              item.batch_number ?? "-",
              item.expiry_date ? formatDate(item.expiry_date) : "-",
            ];
          });

    openPrintPreview(
      `Purchase Invoice ${transaction.invoice_number}`,
      `${businessBrandingHtml()}
      <h2>Purchase Invoice</h2>
      <div class="grid">
        <div><strong>Invoice:</strong> ${escapeHtml(transaction.invoice_number)}</div>
        <div><strong>Purchase Date:</strong> ${escapeHtml(formatDate(transaction.purchase_date ?? transaction.created_at))}</div>
        <div><strong>Supplier:</strong> ${escapeHtml(supplier?.supplier_name ?? "Unknown Supplier")}</div>
        <div><strong>Payment Status:</strong> ${escapeHtml(paymentStatus)}</div>
      </div>
      <table>
        <thead>${renderHeaderRows(["Product", "Quantity", "Purchase Price", "Line Total", "Batch", "Expiry"])}</thead>
        <tbody>${renderRows(lineRows)}</tbody>
      </table>
      <div class="summary">
        <p><strong>Purchase Total:</strong> ${escapeHtml(formatPKR(purchaseValue))}</p>
        <p><strong>Linked Purchase Expenses:</strong> ${escapeHtml(formatPKR(linkedExpenseTotal))}</p>
        <p><strong>Landed Invoice Cost:</strong> ${escapeHtml(formatPKR(landedInvoiceCost))}</p>
        <p><strong>Remaining Payable:</strong> ${escapeHtml(formatPKR(remainingPayable))}</p>
      </div>
      ${businessPrintFooterHtml()}`
    );
  };

  const handleExportInventoryCsv = () => {
    downloadCsv(
      "tradeos-inventory-report.csv",
      reorderRecommendations.map((recommendation) => ({
        "Product Name": recommendation.productName,
        Brand: recommendation.brandName || "No brand",
        Category: recommendation.categoryName || "No category",
        "Unit Type": recommendation.unitType,
        "Purchased Quantity": recommendation.purchasedQty,
        "Sold Quantity": recommendation.soldQty,
        "Current Stock": recommendation.currentStock,
        "Reorder Level": recommendation.reorderLevel,
        "Recent 30 Day Sales": recommendation.recentSalesQuantity,
        "Daily Average Sales": recommendation.dailyAverageSales.toFixed(2),
        "Estimated Days Left":
          recommendation.estimatedDaysLeft === null
            ? "No recent sales"
            : Math.max(0, recommendation.estimatedDaysLeft).toFixed(1),
        "Suggested Reorder Quantity": recommendation.suggestedReorderQuantity,
        "Reorder Status": recommendation.status,
      }))
    );
  };

  const handleExportProfitLossCsv = () => {
    const summaryRows = [
      { Section: "Summary", Metric: "Start Date", Value: profitLossStartDate || "All Time" },
      { Section: "Summary", Metric: "End Date", Value: profitLossEndDate || "All Time" },
      { Section: "Summary", Metric: "Total Revenue", Value: profitLossTotals.totalRevenue },
      { Section: "Summary", Metric: "Known Cost of Goods Sold", Value: profitLossTotals.knownCostOfGoodsSold },
      { Section: "Summary", Metric: "Gross Profit on Costed Sales", Value: grossProfitOnCostedSales },
      { Section: "Summary", Metric: "Purchase-Linked Expenses", Value: purchaseLinkedExpenses },
      { Section: "Summary", Metric: "Operating Expenses", Value: operatingExpenses },
      { Section: "Summary", Metric: "Total Recorded Expenses", Value: totalRecordedExpenses },
      { Section: "Summary", Metric: netProfitLabel, Value: mvpNetProfit },
      { Section: "Summary", Metric: "Cost Coverage Percentage", Value: costCoverage.toFixed(2) },
      { Section: "Summary", Metric: "Missing Cost Sales Value", Value: profitLossTotals.missingCostSalesValue },
      { Section: "Summary", Metric: "Missing Cost Sales Lines", Value: profitLossTotals.missingCostSalesLineCount },
    ];
    const categoryRows = expenseCategoryBreakdown.map((category) => ({
      Section: "Expense Category",
      Metric: category.expenseType,
      Value: category.totalAmount,
      Entries: category.entryCount,
    }));
    downloadCsv("tradeos-profit-loss-report.csv", [...summaryRows, ...categoryRows]);
  };

  const getCustomerCreditSummary = (customer: Customer) => {
    const customerCreditTransactionIds = salesTransactions
      .filter(
        (transaction) =>
          transaction.customer_id === customer.id && transaction.payment_type === "credit"
      )
      .map((transaction) => transaction.id);
    const outstandingBalance = customerCreditTransactionIds.reduce(
      (sum, transactionId) =>
        sum + Math.max(0, creditAllocationByTransaction[transactionId]?.remainingUnpaidAmount ?? 0),
      0
    );
    const overdueInvoices = customerCreditTransactionIds
      .map((transactionId) => {
        const transaction = salesTransactionsById[transactionId];
        return {
          transaction,
          remainingUnpaidAmount:
            creditAllocationByTransaction[transactionId]?.remainingUnpaidAmount ?? 0,
        };
      })
      .filter(({ transaction, remainingUnpaidAmount }) => {
        const dueDate = getDateOnly(transaction?.credit_due_date);
        return Boolean(dueDate && remainingUnpaidAmount > 0 && dueDate < todayDateValue);
      });

    return {
      outstandingBalance,
      overdueAmount: overdueInvoices.reduce(
        (sum, invoice) => sum + invoice.remainingUnpaidAmount,
        0
      ),
      overdueInvoiceCount: overdueInvoices.length,
    };
  };

  const handleExportCustomerBalancesCsv = () => {
    downloadCsv(
      "tradeos-customer-balances.csv",
      customers.map((customer) => {
        const summary = getCustomerCreditSummary(customer);
        return {
          "Customer Name": customer.customer_name,
          "Customer Type": customer.customer_type ?? "",
          "Credit Policy": creditPolicyLabels[customer.credit_policy ?? "cash_only"] ?? "Cash Only",
          "Credit Limit": safeNumber(customer.credit_limit),
          "Credit Days": safeNumber(customer.credit_days),
          "Outstanding Balance": summary.outstandingBalance,
          "Overdue Amount": summary.overdueAmount,
          "Overdue Invoice Count": summary.overdueInvoiceCount,
          "Above Limit Allowed": customer.allow_over_limit ? "Yes" : "No",
          "Overdue Sales Allowed": customer.allow_overdue_sales ? "Yes" : "No",
        };
      })
    );
  };

  const handleExportSupplierBalancesCsv = () => {
    downloadCsv(
      "tradeos-supplier-balances.csv",
      suppliers.map((supplier) => {
        const supplierTransactionIds = purchaseTransactions
          .filter((transaction) => transaction.supplier_id === supplier.id)
          .map((transaction) => transaction.id);
        const totalPurchases = supplierTransactionIds.reduce(
          (sum, transactionId) =>
            sum + (supplierPaymentAllocationByPurchaseTransaction[transactionId]?.purchaseTotal ?? 0),
          0
        );
        const totalPayments = totalSupplierPaymentsBySupplier[supplier.id] ?? 0;
        const currentPayable = supplierTransactionIds.reduce(
          (sum, transactionId) =>
            sum +
            Math.max(
              0,
              supplierPaymentAllocationByPurchaseTransaction[transactionId]?.remainingPayableAmount ?? 0
            ),
          0
        );
        const unallocatedPayments = supplierPayments
          .filter((payment) => payment.supplier_id === supplier.id)
          .reduce((sum, payment) => {
            const paymentId = String(payment.id ?? "");
            return (
              sum +
              Math.max(
                0,
                safeNumber(payment.amount) - (explicitSupplierAllocationsByPayment[paymentId] ?? 0)
              )
            );
          }, 0);
        return {
          "Supplier Name": supplier.supplier_name,
          "Total Purchases": totalPurchases,
          "Total Payments": totalPayments,
          "Current Payable": currentPayable,
          "Unallocated Payments": unallocatedPayments,
        };
      })
    );
  };

  const handlePrintCustomerStatement = (customerId: string | null) => {
    if (!customerId) return;
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;
    const customerCreditTransactions = salesTransactions.filter(
      (transaction) => transaction.customer_id === customerId && transaction.payment_type === "credit"
    );
    const totalCreditSales = customerCreditTransactions.reduce(
      (sum, transaction) => sum + (creditAllocationByTransaction[transaction.id]?.invoiceTotal ?? 0),
      0
    );
    const totalPayments = totalCustomerPaymentsByCustomer[customerId] ?? 0;
    const summary = getCustomerCreditSummary(customer);
    const invoiceRows =
      customerCreditTransactions.length === 0
        ? [["No credit invoices found", "-", formatPKR(0), formatPKR(0), formatPKR(0), "-"]]
        : customerCreditTransactions.map((transaction) => {
            const allocation = creditAllocationByTransaction[transaction.id];
            const remainingBalance = Math.max(0, allocation?.remainingUnpaidAmount ?? 0);
            const dueDate = getDateOnly(transaction.credit_due_date);
            const status =
              remainingBalance <= 0
                ? "Paid"
                : dueDate && dueDate < todayDateValue
                  ? "Overdue"
                  : "Credit outstanding";
            return [
              transaction.invoice_number,
              formatDate(transaction.sale_date ?? transaction.created_at),
              formatPKR(allocation?.invoiceTotal ?? 0),
              formatPKR(allocation?.allocatedAmount ?? 0),
              formatPKR(remainingBalance),
              status,
            ];
          });

    openPrintPreview(
      `Customer Statement ${customer.customer_name}`,
      `${businessBrandingHtml()}
      <h2>Customer Statement</h2>
      <div class="grid">
        <div><strong>Customer:</strong> ${escapeHtml(customer.customer_name)}</div>
        <div><strong>Credit Policy:</strong> ${escapeHtml(creditPolicyLabels[customer.credit_policy ?? "cash_only"] ?? "Cash Only")}</div>
        <div><strong>Total Credit Sales:</strong> ${escapeHtml(formatPKR(totalCreditSales))}</div>
        <div><strong>Total Payments:</strong> ${escapeHtml(formatPKR(totalPayments))}</div>
        <div><strong>Outstanding Balance:</strong> ${escapeHtml(formatPKR(summary.outstandingBalance))}</div>
      </div>
      <table>
        <thead>${renderHeaderRows(["Invoice", "Sale Date", "Invoice Total", "Paid", "Remaining", "Status"])}</thead>
        <tbody>${renderRows(invoiceRows)}</tbody>
      </table>
      ${businessPrintFooterHtml()}`
    );
  };

  const handlePrintSupplierLedger = () => {
    if (!selectedSupplierLedgerId) return;
    const supplier = suppliers.find((item) => item.id === selectedSupplierLedgerId);
    if (!supplier) return;
    const ledgerRows =
      supplierLedgerEntries.length === 0
        ? [["No supplier ledger entries in this date range", "-", "-", formatPKR(0), formatPKR(0), formatPKR(0)]]
        : supplierLedgerEntries.map((entry) => [
            entry.date ?? "-",
            entry.reference,
            entry.notes || "-",
            formatPKR(entry.debit),
            formatPKR(entry.credit),
            formatPKR(entry.runningBalance),
          ]);

    openPrintPreview(
      `Supplier Ledger ${supplier.supplier_name}`,
      `${businessBrandingHtml()}
      <h2>Supplier Ledger</h2>
      <div class="grid">
        <div><strong>Supplier:</strong> ${escapeHtml(supplier.supplier_name)}</div>
        <div><strong>Date Range:</strong> ${escapeHtml(supplierLedgerStartDate || "All Time")} to ${escapeHtml(supplierLedgerEndDate || "All Time")}</div>
        <div><strong>Total Purchases:</strong> ${escapeHtml(formatPKR(supplierLedgerTotalPurchases))}</div>
        <div><strong>Total Payments:</strong> ${escapeHtml(formatPKR(supplierLedgerTotalPayments))}</div>
        <div><strong>Current Payable:</strong> ${escapeHtml(formatPKR(supplierLedgerCurrentBalance))}</div>
        <div><strong>Unallocated Payments:</strong> ${escapeHtml(formatPKR(supplierLedgerUnallocatedPayments))}</div>
      </div>
      <table>
        <thead>${renderHeaderRows(["Date", "Reference", "Notes", "Debit", "Credit", "Running Balance"])}</thead>
        <tbody>${renderRows([["-", "Opening balance", "MVP opening balance", formatPKR(0), formatPKR(0), formatPKR(0)], ...ledgerRows])}</tbody>
      </table>
      ${businessPrintFooterHtml()}`
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading(true);

    console.log({
      brand_id: selectedBrandId,
      category_id: selectedCategoryId,
    });

    if (!requireOrganization("save product")) {
      setError("Organization not loaded. Please login again.");
      setLoading(false);
      return;
    }

    const { data: productData, error: insertError } = await supabase.from("products").insert({
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
    }).select("id").single();

    setLoading(false);

    if (insertError) {
      setError("Failed to save product");
      console.error("Supabase insert error:", insertError);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "product",
      entity_id: productData?.id ?? null,
      entity_label: name,
      description: `Created product ${name}`,
      new_values: {
        name,
        brand_id: selectedBrandId,
        category_id: selectedCategoryId,
        unit_type: unitType,
        minimum_stock_level: minimumStockLevel ? Number(minimumStockLevel) : null,
        reorder_level: reorderLevel ? Number(reorderLevel) : 0,
      },
    });
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

  const handleSectionChange = (sectionId: SectionId) => {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
    window.setTimeout(() => {
      document.getElementById("tradeos-main-content")?.scrollTo({ top: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  };

  const getMarketLabel = (options: Array<{ value: string; label: string }>, value: string | null | undefined) =>
    options.find((option) => option.value === value)?.label ?? value ?? "-";

  const resetMarketIntelligenceForm = () => {
    setMarketTitle("");
    setMarketSummary("");
    setMarketSourceName("");
    setMarketSourceUrl("");
    setMarketCategory("");
    setMarketRelatedProductCategory("");
    setMarketRelatedProductId("");
    setMarketImpactDirection("");
    setMarketImpactLevel("");
    setMarketConfidenceLevel("");
    setMarketAffectedArea("");
    setMarketSuggestedAction("");
    setMarketNewsDate(toDateInputValue(new Date()));
    setMarketStatus("active");
    setSelectedMarketImportQueueId("");
    setSelectedAiAnalysisId("");
  };

  const fillMarketExample = (example: (typeof marketIntelligenceExampleChips)[number]) => {
    setSelectedMarketImportQueueId("");
    setSelectedAiAnalysisId("");
    setMarketTitle(example.title);
    setMarketSummary(example.summary);
    setMarketCategory(example.market_category);
    setMarketImpactDirection(example.impact_direction);
    setMarketImpactLevel(example.impact_level);
    setMarketConfidenceLevel(example.confidence_level);
    setMarketAffectedArea(example.affected_area);
    setMarketSuggestedAction(example.suggested_action);
    setMarketStatus("active");
    setMarketNewsDate(toDateInputValue(new Date()));
  };

  const resetMarketImportQueueForm = () => {
    setMarketImportSourceName("");
    setMarketImportSourceUrl("");
    setMarketImportRawTitle("");
    setMarketImportRawSummary("");
    setMarketImportRawText("");
    setMarketImportSuggestedCategory("");
    setMarketImportSuggestedImpactDirection("");
    setMarketImportSuggestedImpactLevel("");
    setMarketImportSuggestedConfidenceLevel("");
    setMarketImportSuggestedAffectedArea("");
    setMarketImportSuggestedAction("");
    setMarketImportNotes("");
  };

  const fillMarketImportExample = (example: (typeof marketImportQueueExampleChips)[number]) => {
    setMarketImportRawTitle(example.raw_title);
    setMarketImportRawSummary(example.raw_summary);
    setMarketImportRawText(example.raw_text);
    setMarketImportSuggestedCategory(example.suggested_market_category);
    setMarketImportSuggestedImpactDirection(example.suggested_impact_direction);
    setMarketImportSuggestedImpactLevel(example.suggested_impact_level);
    setMarketImportSuggestedConfidenceLevel(example.suggested_confidence_level);
    setMarketImportSuggestedAffectedArea(example.suggested_affected_area);
    setMarketImportSuggestedAction(example.suggested_action);
  };

  const createMarketImportQueueItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMarketImportQueueMessage(null);
    setMarketImportQueueError(null);

    if (!requireOrganization("create market import queue item")) {
      setMarketImportQueueError("Organization not loaded. Please login again.");
      return;
    }

    const hasRawInput = [
      marketImportRawTitle,
      marketImportRawSummary,
      marketImportRawText,
      marketImportSourceUrl,
    ].some((value) => value.trim().length > 0);
    if (!hasRawInput) {
      setMarketImportQueueError("Add at least a raw title, summary, text note, or source URL.");
      return;
    }

    const payload = {
      organization_id: currentOrganizationId,
      created_by_profile_id: currentProfile?.id ?? null,
      source_name: safeTextOrNull(marketImportSourceName),
      source_url: safeTextOrNull(marketImportSourceUrl),
      raw_title: safeTextOrNull(marketImportRawTitle),
      raw_summary: safeTextOrNull(marketImportRawSummary),
      raw_text: safeTextOrNull(marketImportRawText),
      suggested_market_category: marketImportSuggestedCategory || null,
      suggested_impact_direction: marketImportSuggestedImpactDirection || null,
      suggested_impact_level: marketImportSuggestedImpactLevel || null,
      suggested_confidence_level: marketImportSuggestedConfidenceLevel || null,
      suggested_affected_area: marketImportSuggestedAffectedArea || null,
      suggested_action: safeTextOrNull(marketImportSuggestedAction),
      review_status: "pending",
      converted_intelligence_item_id: null,
      notes: safeTextOrNull(marketImportNotes),
    };

    const { data, error } = await supabase
      .from("market_import_queue")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("Supabase market import queue insert error:", JSON.stringify(error, null, 2));
      setMarketImportQueueError(`Failed to add import queue item: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "market_import_queue",
      entity_id: data?.id ?? null,
      entity_label: payload.raw_title ?? payload.source_name ?? "Market import queue item",
      description: "Created market import queue item",
      new_values: payload,
    });
    resetMarketImportQueueForm();
    await fetchMarketImportQueueItems(currentOrganizationId);
    setMarketImportQueueMessage("Import queue item added for review.");
  };

  const createMarketIntelligenceItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMarketIntelligenceMessage(null);
    setMarketIntelligenceError(null);

    if (!requireOrganization("create market intelligence item")) {
      setMarketIntelligenceError("Organization not loaded. Please login again.");
      return;
    }

    const title = marketTitle.trim();
    if (!title) {
      setMarketIntelligenceError("Title is required.");
      return;
    }
    if (!marketCategory || !marketImpactDirection || !marketImpactLevel || !marketConfidenceLevel || !marketAffectedArea) {
      setMarketIntelligenceError("Market category, impact direction, impact level, confidence, and affected area are required.");
      return;
    }

    const payload = {
      organization_id: currentOrganizationId,
      created_by_profile_id: currentProfile?.id ?? null,
      title,
      summary: safeTextOrNull(marketSummary),
      source_name: safeTextOrNull(marketSourceName),
      source_url: safeTextOrNull(marketSourceUrl),
      market_category: marketCategory,
      related_product_category: safeTextOrNull(marketRelatedProductCategory),
      related_product_id: marketRelatedProductId || null,
      impact_direction: marketImpactDirection,
      impact_level: marketImpactLevel,
      confidence_level: marketConfidenceLevel,
      affected_area: marketAffectedArea,
      suggested_action: safeTextOrNull(marketSuggestedAction),
      news_date: marketNewsDate || null,
      status: marketStatus || "active",
    };

    const { data, error } = await supabase
      .from("market_intelligence_items")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("Supabase market intelligence insert error:", JSON.stringify(error, null, 2));
      setMarketIntelligenceError(`Failed to add market intelligence item: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "market_intelligence_item",
      entity_id: data?.id ?? null,
      entity_label: title,
      description: `Created market intelligence item ${title}`,
      new_values: payload,
    });
    let conversionWarning: string | null = null;
    if (selectedMarketImportQueueId) {
      if (!isValidUuid(selectedMarketImportQueueId)) {
        conversionWarning = "Intelligence item saved, but selected import queue ID was invalid.";
      } else {
        const now = new Date().toISOString();
        const { error: queueUpdateError } = await supabase
          .from("market_import_queue")
          .update({
            review_status: "converted",
            converted_intelligence_item_id: data?.id ?? null,
            reviewed_at: now,
            updated_at: now,
          })
          .eq("id", selectedMarketImportQueueId)
          .eq("organization_id", currentOrganizationId);

        if (queueUpdateError) {
          console.error("Supabase market import queue conversion update error:", JSON.stringify(queueUpdateError, null, 2));
          conversionWarning = "Intelligence item saved, but import queue item could not be marked converted.";
        } else {
          await createAuditLog({
            action: "updated",
            entity_type: "market_import_queue",
            entity_id: selectedMarketImportQueueId,
            entity_label: title,
            description: `Converted import queue item into market intelligence item ${title}`,
            new_values: {
              review_status: "converted",
              converted_intelligence_item_id: data?.id ?? null,
            },
          });
          setSelectedMarketImportQueueId("");
          await fetchMarketImportQueueItems(currentOrganizationId);
        }
      }
    }
    if (selectedAiAnalysisId) {
      if (!isValidUuid(selectedAiAnalysisId)) {
        conversionWarning = conversionWarning
          ? `${conversionWarning} AI analysis ID was invalid.`
          : "Intelligence item saved, but selected AI analysis ID was invalid.";
      } else {
        const now = new Date().toISOString();
        const { error: aiAnalysisUpdateError } = await supabase
          .from("market_ai_analyses")
          .update({
            review_status: "converted",
            converted_intelligence_item_id: data?.id ?? null,
            reviewed_at: now,
            updated_at: now,
          })
          .eq("id", selectedAiAnalysisId)
          .eq("organization_id", currentOrganizationId);

        if (aiAnalysisUpdateError) {
          console.error("Supabase market AI analysis conversion update error:", JSON.stringify(aiAnalysisUpdateError, null, 2));
          conversionWarning = conversionWarning
            ? `${conversionWarning} AI analysis could not be marked converted.`
            : "Intelligence item saved, but AI analysis could not be marked converted.";
        } else {
          await createAuditLog({
            action: "updated",
            entity_type: "market_ai_analysis",
            entity_id: selectedAiAnalysisId,
            entity_label: title,
            description: `Converted AI analysis into market intelligence item ${title}`,
            new_values: {
              review_status: "converted",
              converted_intelligence_item_id: data?.id ?? null,
            },
          });
          setSelectedAiAnalysisId("");
          await fetchMarketAiAnalyses(currentOrganizationId);
        }
      }
    }
    resetMarketIntelligenceForm();
    await fetchMarketIntelligenceItems(currentOrganizationId);
    setMarketIntelligenceMessage(conversionWarning ?? "Market intelligence item added.");
  };

  const createMarketNewsSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMarketIntelligenceMessage(null);
    setMarketIntelligenceError(null);

    if (!requireOrganization("create market news source")) {
      setMarketIntelligenceError("Organization not loaded. Please login again.");
      return;
    }

    const sourceName = marketNewsSourceName.trim();
    const sourceType = marketNewsSourceType.trim();
    if (!sourceName || !sourceType) {
      setMarketIntelligenceError("Source name and source type are required.");
      return;
    }

    const payload = {
      organization_id: currentOrganizationId,
      source_name: sourceName,
      source_type: sourceType,
      source_url: safeTextOrNull(marketNewsSourceUrl),
      country: safeTextOrNull(marketNewsSourceCountry) ?? "Pakistan",
      is_active: marketNewsSourceIsActive,
    };

    const { data, error } = await supabase
      .from("market_news_sources")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("Supabase market news source insert error:", JSON.stringify(error, null, 2));
      setMarketIntelligenceError(`Failed to add news source: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "created",
      entity_type: "market_news_source",
      entity_id: data?.id ?? null,
      entity_label: sourceName,
      description: `Created market news source ${sourceName}`,
      new_values: payload,
    });
    setMarketNewsSourceName("");
    setMarketNewsSourceType("");
    setMarketNewsSourceUrl("");
    setMarketNewsSourceCountry("Pakistan");
    setMarketNewsSourceIsActive(true);
    await fetchMarketNewsSources(currentOrganizationId);
    setMarketIntelligenceMessage("Market news source added.");
  };

  const updateMarketIntelligenceStatus = async (
    item: MarketIntelligenceItem,
    nextStatus: "active" | "watching" | "archived"
  ) => {
    setMarketIntelligenceMessage(null);
    setMarketIntelligenceError(null);

    if (!requireOrganization("update market intelligence status")) {
      setMarketIntelligenceError("Organization not loaded. Please login again.");
      return;
    }

    const itemId = item.id;
    const allowedStatuses = ["active", "watching", "archived"];
    if (!itemId || !isValidUuid(itemId)) {
      setMarketIntelligenceError("Cannot update status because this market intelligence item has an invalid ID.");
      return;
    }

    if (!allowedStatuses.includes(nextStatus)) {
      setMarketIntelligenceError("Cannot update status because the requested status is not supported.");
      return;
    }

    const updatePayload = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase
        .from("market_intelligence_items")
        .update(updatePayload)
        .eq("id", itemId)
        .eq("organization_id", currentOrganizationId);

      if (error) {
        console.error("Supabase market intelligence status update error:", error);
        setMarketIntelligenceError("Failed to update item status. Please try again.");
        return;
      }
    } catch (err) {
      console.error("Supabase market intelligence status update error:", err);
      setMarketIntelligenceError("Failed to update item status. Please try again.");
      return;
    }

    await createAuditLog({
      action: "updated",
      entity_type: "market_intelligence_item",
      entity_id: itemId,
      entity_label: item.title,
      description: `Updated market intelligence item ${item.title} to ${nextStatus}`,
      old_values: { status: item.status },
      new_values: updatePayload,
    });
    await fetchMarketIntelligenceItems(currentOrganizationId);
    setMarketIntelligenceError(null);
    setMarketIntelligenceMessage(`Market intelligence item marked ${nextStatus}.`);
  };

  const updateMarketImportQueueStatus = async (
    item: MarketImportQueueItem,
    nextStatus: "pending" | "reviewing" | "ignored"
  ) => {
    setMarketImportQueueMessage(null);
    setMarketImportQueueError(null);

    if (!requireOrganization("update market import queue status")) {
      setMarketImportQueueError("Organization not loaded. Please login again.");
      return;
    }

    if (!item.id || !isValidUuid(item.id)) {
      setMarketImportQueueError("Cannot update import queue status because this item has an invalid ID.");
      return;
    }

    const allowedStatuses = ["pending", "reviewing", "ignored"];
    if (!allowedStatuses.includes(nextStatus)) {
      setMarketImportQueueError("Cannot update import queue status because the requested status is not supported.");
      return;
    }

    const now = new Date().toISOString();
    const updatePayload = {
      review_status: nextStatus,
      updated_at: now,
      reviewed_at: nextStatus === "pending" ? null : now,
    };

    const { error } = await supabase
      .from("market_import_queue")
      .update(updatePayload)
      .eq("id", item.id)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase market import queue status update error:", JSON.stringify(error, null, 2));
      setMarketImportQueueError("Failed to update import queue status. Please try again.");
      return;
    }

    await createAuditLog({
      action: "updated",
      entity_type: "market_import_queue",
      entity_id: item.id,
      entity_label: item.raw_title ?? item.source_name ?? "Market import queue item",
      description: `Updated market import queue item to ${nextStatus}`,
      old_values: { review_status: item.review_status },
      new_values: updatePayload,
    });
    await fetchMarketImportQueueItems(currentOrganizationId);
    setMarketImportQueueMessage(`Import queue item marked ${nextStatus}.`);
  };

  const convertMarketImportQueueItem = (item: MarketImportQueueItem) => {
    setSelectedMarketImportQueueId(item.id);
    setSelectedAiAnalysisId("");
    setMarketTitle(item.raw_title ?? item.source_name ?? "");
    setMarketSummary(item.raw_summary ?? item.raw_text ?? "");
    setMarketSourceName(item.source_name ?? "");
    setMarketSourceUrl(item.source_url ?? "");
    setMarketCategory(item.suggested_market_category ?? "");
    setMarketRelatedProductCategory("");
    setMarketRelatedProductId("");
    setMarketImpactDirection(item.suggested_impact_direction ?? "");
    setMarketImpactLevel(item.suggested_impact_level ?? "");
    setMarketConfidenceLevel(item.suggested_confidence_level ?? "");
    setMarketAffectedArea(item.suggested_affected_area ?? "");
    setMarketSuggestedAction(item.suggested_action ?? "");
    setMarketNewsDate(toDateInputValue(new Date()));
    setMarketStatus("active");
    setMarketIntelligenceMessage("Review details, then save as intelligence item.");
    window.setTimeout(() => {
      document.getElementById("market-intelligence-item-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  };

  const runMarketAiAnalysis = async ({
    loadingId,
    marketImportQueueId,
    marketIntelligenceItemId,
    title,
    summary,
    rawText,
    sourceName,
    sourceUrl,
    marketCategory,
  }: {
    loadingId: string;
    marketImportQueueId?: string | null;
    marketIntelligenceItemId?: string | null;
    title: string | null;
    summary: string | null;
    rawText: string | null;
    sourceName: string | null;
    sourceUrl: string | null;
    marketCategory: string | null;
  }) => {
    setMarketAiAnalysisMessage(null);
    setMarketAiAnalysisError(null);

    if (!requireOrganization("analyze market intelligence with AI")) {
      setMarketAiAnalysisError("Organization not loaded. Please login again.");
      return;
    }

    if (!isOwnerOrAdmin()) {
      setMarketAiAnalysisError("Only owner/admin users can run AI market analysis.");
      return;
    }

    const sourceId = marketImportQueueId ?? marketIntelligenceItemId;
    if (!sourceId || !isValidUuid(sourceId)) {
      setMarketAiAnalysisError("Cannot analyze this item because its ID is invalid.");
      return;
    }

    setMarketAiAnalysisLoadingId(loadingId);
    try {
      const response = await fetch("/api/market-intelligence/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary,
          raw_text: rawText,
          source_name: sourceName,
          source_url: sourceUrl,
          market_category: marketCategory,
          context_country: "Pakistan",
          business_context: "TradeOS wholesale/FMCG business management app",
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        const safeDetails =
          typeof result?.details === "string"
            ? result.details
            : result?.details
              ? JSON.stringify(result.details)
              : "";
        setMarketAiAnalysisError(
          safeDetails
            ? `AI analysis failed: ${result?.error ?? "Request failed"} - ${safeDetails}`
            : result?.error ?? "AI analysis failed. Please try again."
        );
        return;
      }

      const analysis = result.analysis ?? {};
      const payload = {
        organization_id: currentOrganizationId,
        created_by_profile_id: currentProfile?.id ?? null,
        market_import_queue_id: marketImportQueueId ?? null,
        market_intelligence_item_id: marketIntelligenceItemId ?? null,
        input_title: safeTextOrNull(title ?? ""),
        input_summary: safeTextOrNull(summary ?? ""),
        input_text: safeTextOrNull(rawText ?? ""),
        input_source_name: safeTextOrNull(sourceName ?? ""),
        input_source_url: safeTextOrNull(sourceUrl ?? ""),
        ai_summary: safeTextOrNull(analysis.summary),
        ai_reasoning: safeTextOrNull(analysis.reasoning),
        ai_market_category: analysis.market_category ?? "general_fmcg",
        ai_impact_direction: analysis.impact_direction ?? "neutral",
        ai_impact_level: analysis.impact_level ?? "medium",
        ai_confidence_level: analysis.confidence_level ?? "medium",
        ai_affected_area: analysis.affected_area ?? "business",
        ai_suggested_action: safeTextOrNull(analysis.suggested_action),
        ai_risks: safeTextOrNull(analysis.risks),
        ai_owner_questions: safeTextOrNull(analysis.owner_questions),
        raw_ai_response: result.raw ?? null,
        review_status: "draft",
      };

      const { data, error } = await supabase
        .from("market_ai_analyses")
        .insert(payload)
        .select("id")
        .single();

      if (error) {
        console.error("Supabase market AI analysis insert error:", JSON.stringify(error, null, 2));
        setMarketAiAnalysisError(`Failed to save AI analysis: ${JSON.stringify(error, null, 2)}`);
        return;
      }

      await createAuditLog({
        action: "created",
        entity_type: "market_ai_analysis",
        entity_id: data?.id ?? null,
        entity_label: payload.input_title ?? "Market AI analysis",
        description: "Created market AI analysis",
        new_values: payload,
      });
      await fetchMarketAiAnalyses(currentOrganizationId);
      setMarketAiAnalysisMessage("AI analysis created for owner review.");
    } catch (error) {
      console.error("Market AI analysis request error:", error);
      setMarketAiAnalysisError("AI analysis failed. Please try again.");
    } finally {
      setMarketAiAnalysisLoadingId("");
    }
  };

  const analyzeMarketImportQueueItem = (item: MarketImportQueueItem) =>
    runMarketAiAnalysis({
      loadingId: `queue-${item.id}`,
      marketImportQueueId: item.id,
      title: item.raw_title,
      summary: item.raw_summary,
      rawText: item.raw_text,
      sourceName: item.source_name,
      sourceUrl: item.source_url,
      marketCategory: item.suggested_market_category,
    });

  const analyzeMarketIntelligenceItem = (item: MarketIntelligenceItem) =>
    runMarketAiAnalysis({
      loadingId: `item-${item.id}`,
      marketIntelligenceItemId: item.id,
      title: item.title,
      summary: item.summary,
      rawText: item.suggested_action,
      sourceName: item.source_name,
      sourceUrl: item.source_url,
      marketCategory: item.market_category,
    });

  const convertMarketAiAnalysisToIntelligenceItem = (analysis: MarketAiAnalysis) => {
    setSelectedAiAnalysisId(analysis.id);
    setSelectedMarketImportQueueId("");
    const summaryParts = [
      analysis.ai_summary,
      analysis.ai_reasoning ? `Reasoning: ${analysis.ai_reasoning}` : "",
      analysis.ai_risks ? `Risks: ${analysis.ai_risks}` : "",
      analysis.ai_owner_questions ? `Owner questions: ${analysis.ai_owner_questions}` : "",
    ].filter(Boolean);
    setMarketTitle(analysis.input_title ?? analysis.ai_summary ?? "AI market analysis");
    setMarketSummary(summaryParts.join("\n\n"));
    setMarketSourceName(analysis.input_source_name ?? "");
    setMarketSourceUrl(analysis.input_source_url ?? "");
    setMarketCategory(analysis.ai_market_category ?? "general_fmcg");
    setMarketRelatedProductCategory("");
    setMarketRelatedProductId("");
    setMarketImpactDirection(analysis.ai_impact_direction ?? "neutral");
    setMarketImpactLevel(analysis.ai_impact_level ?? "medium");
    setMarketConfidenceLevel(analysis.ai_confidence_level ?? "medium");
    setMarketAffectedArea(analysis.ai_affected_area ?? "business");
    setMarketSuggestedAction(analysis.ai_suggested_action ?? "");
    setMarketNewsDate(toDateInputValue(new Date()));
    setMarketStatus("active");
    setMarketAiAnalysisMessage("Review AI analysis, then save as intelligence item.");
    window.setTimeout(() => {
      document.getElementById("market-intelligence-item-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  };

  const updateMarketAiAnalysisStatus = async (
    analysis: MarketAiAnalysis,
    nextStatus: "draft" | "reviewed" | "ignored"
  ) => {
    setMarketAiAnalysisMessage(null);
    setMarketAiAnalysisError(null);

    if (!requireOrganization("update market AI analysis status")) {
      setMarketAiAnalysisError("Organization not loaded. Please login again.");
      return;
    }

    if (!analysis.id || !isValidUuid(analysis.id)) {
      setMarketAiAnalysisError("Cannot update AI analysis status because this analysis has an invalid ID.");
      return;
    }

    const allowedStatuses = ["draft", "reviewed", "ignored"];
    if (!allowedStatuses.includes(nextStatus)) {
      setMarketAiAnalysisError("Cannot update AI analysis because the requested status is not supported.");
      return;
    }

    const now = new Date().toISOString();
    const updatePayload = {
      review_status: nextStatus,
      reviewed_at: nextStatus === "draft" ? null : now,
      updated_at: now,
    };

    const { error } = await supabase
      .from("market_ai_analyses")
      .update(updatePayload)
      .eq("id", analysis.id)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase market AI analysis status update error:", JSON.stringify(error, null, 2));
      setMarketAiAnalysisError("Failed to update AI analysis status. Please try again.");
      return;
    }

    await createAuditLog({
      action: "updated",
      entity_type: "market_ai_analysis",
      entity_id: analysis.id,
      entity_label: analysis.input_title ?? analysis.ai_summary ?? "Market AI analysis",
      description: `Updated market AI analysis to ${nextStatus}`,
      old_values: { review_status: analysis.review_status },
      new_values: updatePayload,
    });
    await fetchMarketAiAnalyses(currentOrganizationId);
    setMarketAiAnalysisMessage(`AI analysis marked ${nextStatus}.`);
  };

  const deleteMarketIntelligenceItem = async (item: MarketIntelligenceItem) => {
    if (!window.confirm(`Delete market intelligence item "${item.title}"?`)) return;
    setMarketIntelligenceMessage(null);
    setMarketIntelligenceError(null);

    if (!requireOrganization("delete market intelligence item")) {
      setMarketIntelligenceError("Organization not loaded. Please login again.");
      return;
    }

    const { error } = await supabase
      .from("market_intelligence_items")
      .delete()
      .eq("id", item.id)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase market intelligence delete error:", JSON.stringify(error, null, 2));
      setMarketIntelligenceError(`Failed to delete item: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "deleted",
      entity_type: "market_intelligence_item",
      entity_id: item.id,
      entity_label: item.title,
      description: `Deleted market intelligence item ${item.title}`,
      old_values: { ...item },
    });
    await fetchMarketIntelligenceItems(currentOrganizationId);
    setMarketIntelligenceMessage("Market intelligence item deleted.");
  };

  const deleteMarketNewsSource = async (source: MarketNewsSource) => {
    if (!window.confirm(`Delete news source "${source.source_name}"?`)) return;
    setMarketIntelligenceMessage(null);
    setMarketIntelligenceError(null);

    if (!requireOrganization("delete market news source")) {
      setMarketIntelligenceError("Organization not loaded. Please login again.");
      return;
    }

    const { error } = await supabase
      .from("market_news_sources")
      .delete()
      .eq("id", source.id)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase market news source delete error:", JSON.stringify(error, null, 2));
      setMarketIntelligenceError(`Failed to delete source: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "deleted",
      entity_type: "market_news_source",
      entity_id: source.id,
      entity_label: source.source_name,
      description: `Deleted market news source ${source.source_name}`,
      old_values: { ...source },
    });
    await fetchMarketNewsSources(currentOrganizationId);
    setMarketIntelligenceMessage("Market news source deleted.");
  };

  const handleSaveBusinessSettings = async () => {
    setBusinessSettingsMessage(null);
    setBusinessSettingsError(null);

    const trimmedName = businessSettingsName.trim();
    if (!trimmedName) {
      setBusinessSettingsError("Business name is required.");
      return;
    }

    if (!requireOrganization("save business settings")) {
      setBusinessSettingsError("Organization not loaded. Please login again.");
      return;
    }

    setBusinessSettingsLoading(true);

    const optionalValue = (value: string) => {
      const trimmedValue = value.trim();
      return trimmedValue ? trimmedValue : null;
    };

    try {
      const oldBusinessSettings = currentOrganization
        ? {
            name: currentOrganization.name ?? null,
            phone: currentOrganization.phone ?? null,
            address: currentOrganization.address ?? null,
            city: currentOrganization.city ?? null,
            invoice_footer_note: currentOrganization.invoice_footer_note ?? null,
            default_payment_terms: currentOrganization.default_payment_terms ?? null,
          }
        : null;
      const newBusinessSettings = {
        name: trimmedName,
        phone: optionalValue(businessSettingsPhone),
        address: optionalValue(businessSettingsAddress),
        city: optionalValue(businessSettingsCity),
        invoice_footer_note: optionalValue(businessSettingsInvoiceFooterNote),
        default_payment_terms: optionalValue(businessSettingsDefaultPaymentTerms),
      };
      const { error } = await supabase
        .from("organizations")
        .update(newBusinessSettings)
        .eq("id", currentOrganizationId);

      if (error) {
        console.error("Supabase business settings update error:", JSON.stringify(error, null, 2));
        setBusinessSettingsError(`Failed to save business settings: ${JSON.stringify(error, null, 2)}`);
        return;
      }

      await createAuditLog({
        action: "updated",
        entity_type: "business_settings",
        entity_id: currentOrganizationId,
        entity_label: trimmedName,
        description: "Updated business settings",
        old_values: oldBusinessSettings,
        new_values: newBusinessSettings,
      });
      await fetchCurrentOrganization(currentOrganizationId);
      setBusinessSettingsMessage("Business settings saved successfully.");
    } catch (err) {
      setBusinessSettingsError(
        err instanceof Error ? err.message : "Failed to save business settings."
      );
      console.error("Error saving business settings:", err);
    } finally {
      setBusinessSettingsLoading(false);
    }
  };

  const updateStaffProfileDraft = (
    profileId: string,
    field: "display_name" | "role" | "is_active",
    value: string | boolean
  ) => {
    setStaffProfileDrafts((current) => {
      const profile = staffProfiles.find((item) => item.id === profileId);
      const existing = current[profileId] ?? {
        display_name: profile?.display_name ?? "",
        role: profile?.role ?? "staff",
        is_active: profile?.is_active !== false,
      };
      return {
        ...current,
        [profileId]: {
          ...existing,
          [field]: value,
        },
      };
    });
  };

  const saveStaffProfile = async (profileId: string) => {
    setStaffPermissionMessage(null);
    setStaffPermissionError(null);

    if (!profileId || !requireOrganization("update staff profile")) {
      setStaffPermissionError("Staff profile or organization is missing.");
      return;
    }

    const profile = staffProfiles.find((item) => item.id === profileId);
    if (!profile) {
      setStaffPermissionError("Staff profile was not found.");
      return;
    }

    const draft = staffProfileDrafts[profileId] ?? {
      display_name: profile.display_name ?? "",
      role: profile.role ?? "staff",
      is_active: profile.is_active !== false,
    };
    const nextRole = staffRoles.includes(draft.role) ? draft.role : "staff";
    const isSelf = currentProfile?.id === profileId;

    if (isSelf && draft.is_active === false) {
      setStaffPermissionError("You cannot deactivate your own account.");
      return;
    }

    if (isSelf && currentProfile?.role === "owner" && nextRole !== "owner") {
      setStaffPermissionError("You cannot remove your own owner role.");
      return;
    }

    const updatePayload = {
      display_name: draft.display_name.trim() || null,
      role: nextRole,
      is_active: Boolean(draft.is_active),
    };

    const { error } = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", profileId)
      .eq("organization_id", currentOrganizationId);

    if (error) {
      console.error("Supabase staff profile update error:", JSON.stringify(error, null, 2));
      setStaffPermissionError(`Failed to update staff profile: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "updated",
      entity_type: "staff_profile",
      entity_id: profileId,
      entity_label: updatePayload.display_name ?? profile.email ?? profileId,
      description: `Updated staff profile ${updatePayload.display_name ?? profile.email ?? profileId}`,
      old_values: {
        display_name: profile.display_name ?? null,
        role: profile.role ?? null,
        is_active: profile.is_active ?? null,
      },
      new_values: updatePayload,
    });

    if (isSelf) {
      setCurrentProfile((current: any | null) => (current ? { ...current, ...updatePayload } : current));
    }

    await fetchStaffProfilesAndPermissions(currentOrganizationId);
    setStaffPermissionMessage("Staff profile updated successfully.");
  };

  const saveStaffPermissions = async () => {
    setStaffPermissionMessage(null);
    setStaffPermissionError(null);

    if (!selectedStaffProfileId || !requireOrganization("save staff permissions")) {
      setStaffPermissionError("Please select a staff member first.");
      return;
    }

    const selectedProfile = staffProfiles.find((profile) => profile.id === selectedStaffProfileId);
    if (!selectedProfile) {
      setStaffPermissionError("Selected staff member was not found.");
      return;
    }

    const now = new Date().toISOString();
    const permissionPayload = {
      organization_id: currentOrganizationId,
      profile_id: selectedStaffProfileId,
      can_manage_products: Boolean(staffPermissionDraft.can_manage_products),
      can_manage_customers: Boolean(staffPermissionDraft.can_manage_customers),
      can_manage_suppliers: Boolean(staffPermissionDraft.can_manage_suppliers),
      can_create_purchases: Boolean(staffPermissionDraft.can_create_purchases),
      can_create_sales: Boolean(staffPermissionDraft.can_create_sales),
      can_manage_payments: Boolean(staffPermissionDraft.can_manage_payments),
      can_manage_expenses: Boolean(staffPermissionDraft.can_manage_expenses),
      can_view_profit: Boolean(staffPermissionDraft.can_view_profit),
      can_view_reports: Boolean(staffPermissionDraft.can_view_reports),
      can_manage_tasks: Boolean(staffPermissionDraft.can_manage_tasks),
      can_manage_settings: Boolean(staffPermissionDraft.can_manage_settings),
      updated_at: now,
    };
    const previousPermissions = staffPermissions.find(
      (permission) => permission.profile_id === selectedStaffProfileId
    );

    const { error } = await supabase
      .from("staff_permissions")
      .upsert(permissionPayload, { onConflict: "organization_id,profile_id" });

    if (error) {
      console.error("Supabase staff permissions upsert error:", JSON.stringify(error, null, 2));
      setStaffPermissionError(`Failed to save staff permissions: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    const previousPermissionValues = previousPermissions
      ? staffPermissionLabels.reduce((values, permission) => {
          values[permission.key] = Boolean(previousPermissions[permission.key]);
          return values;
        }, {} as Record<string, unknown>)
      : null;

    await createAuditLog({
      action: "updated",
      entity_type: "staff_permissions",
      entity_id: selectedStaffProfileId,
      entity_label: selectedProfile.display_name ?? selectedProfile.email ?? selectedStaffProfileId,
      description: `Updated staff permissions for ${selectedProfile.display_name ?? selectedProfile.email ?? selectedStaffProfileId}`,
      old_values: previousPermissionValues,
      new_values: permissionPayload,
    });

    await fetchStaffProfilesAndPermissions(currentOrganizationId);
    setStaffPermissionMessage("Staff permissions saved successfully.");
  };

  const seedSecurityChecklist = async () => {
    setSecurityCheckMessage(null);
    setSecurityCheckError(null);

    if (!requireOrganization("seed security checklist")) {
      setSecurityCheckError("Organization not loaded. Please login again.");
      return;
    }

    const existingChecksByKey = new Map(securityChecks.map((check) => [check.check_key, check]));
    const rows = defaultSecurityChecks.map((check) => {
      const existingCheck = existingChecksByKey.get(check.key);
      return {
        organization_id: currentOrganizationId,
        check_key: check.key,
        check_label: check.label,
        status: existingCheck?.status ?? "pending",
        notes: existingCheck?.notes ?? null,
        checked_at: existingCheck?.checked_at ?? new Date().toISOString(),
        checked_by_profile_id: existingCheck?.checked_by_profile_id ?? currentProfile?.id ?? null,
      };
    });

    const { error } = await supabase
      .from("security_checks")
      .upsert(rows, { onConflict: "organization_id,check_key" });

    if (error) {
      console.error("Supabase security checklist seed error:", JSON.stringify(error, null, 2));
      setSecurityCheckError(`Failed to seed security checklist: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await fetchSecurityChecks(currentOrganizationId);
    setSecurityCheckMessage("Security checklist seeded successfully.");
  };

  const updateSecurityCheckStatus = async (
    check: SecurityCheck,
    status: "pending" | "pass" | "fail"
  ) => {
    setSecurityCheckMessage(null);
    setSecurityCheckError(null);

    if (!requireOrganization("update security check")) {
      setSecurityCheckError("Organization not loaded. Please login again.");
      return;
    }

    const notes = securityCheckNotes[check.check_key]?.trim() || null;
    const checkedAt = new Date().toISOString();
    const payload = {
      organization_id: currentOrganizationId,
      check_key: check.check_key,
      check_label: check.check_label,
      status,
      notes,
      checked_at: checkedAt,
      checked_by_profile_id: currentProfile?.id ?? null,
    };

    const { error } = await supabase
      .from("security_checks")
      .upsert(payload, { onConflict: "organization_id,check_key" });

    if (error) {
      console.error("Supabase security check update error:", JSON.stringify(error, null, 2));
      setSecurityCheckError(`Failed to update security check: ${JSON.stringify(error, null, 2)}`);
      return;
    }

    await createAuditLog({
      action: "updated",
      entity_type: "security_check",
      entity_id: check.id ?? check.check_key,
      entity_label: check.check_label,
      description: `Updated security check ${check.check_label} to ${status}`,
      old_values: {
        status: check.status,
        notes: check.notes,
        checked_at: check.checked_at,
      },
      new_values: payload,
    });

    await fetchSecurityChecks(currentOrganizationId);
    setSecurityCheckMessage(`Security check marked ${status}.`);
  };

  if (!currentUser) {
    return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-4 py-8">
        <div className="w-full rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">TradeOS</h1>
            <p className="text-sm text-gray-500">Business Management</p>
          </div>

          <section className="rounded border border-gray-200 bg-gray-50 p-5">
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
        </div>
      </div>
    </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <style>{`
        .tradeos-print-document {
          color: #111827;
          font-family: Arial, sans-serif;
          line-height: 1.4;
        }
        .tradeos-print-document h1,
        .tradeos-print-document h2,
        .tradeos-print-document h3 {
          margin: 0 0 8px;
        }
        .tradeos-print-document .muted {
          color: #6b7280;
        }
        .tradeos-print-document .grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px 24px;
          margin: 16px 0;
        }
        .tradeos-print-document table {
          border-collapse: collapse;
          margin-top: 16px;
          width: 100%;
        }
        .tradeos-print-document th,
        .tradeos-print-document td {
          border: 1px solid #d1d5db;
          font-size: 12px;
          padding: 8px;
          text-align: left;
          vertical-align: top;
        }
        .tradeos-print-document th {
          background: #f3f4f6;
        }
        .tradeos-print-document .summary {
          margin-top: 16px;
          text-align: right;
        }
        .tradeos-print-document .footer {
          border-top: 1px solid #d1d5db;
          margin-top: 32px;
          padding-top: 12px;
        }
        @media print {
          body * {
            visibility: hidden;
          }
          .print-preview-content,
          .print-preview-content * {
            visibility: visible;
          }
          .print-preview-content {
            background: white;
            left: 0;
            padding: 0;
            position: absolute;
            top: 0;
            width: 100%;
          }
          .print-preview-shell,
          .print-preview-actions {
            display: none !important;
          }
          .tradeos-print-document {
            font-size: 12px;
          }
        }
      `}</style>
      {isPrintPreviewOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-950/60 p-4 print:static print:bg-white print:p-0">
          <div className="mx-auto max-w-5xl rounded border border-gray-200 bg-white shadow-xl print:shadow-none">
            <div className="print-preview-shell flex flex-col gap-3 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{printPreviewTitle}</h2>
              <div className="print-preview-actions flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                >
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrintPreviewOpen(false)}
                  className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
            <div
              className="print-preview-content tradeos-print-document p-5"
              dangerouslySetInnerHTML={{ __html: printPreviewHtml }}
            />
          </div>
        </div>
      )}
      <div className="min-h-screen md:flex">
        <aside className="hidden w-64 shrink-0 border-r border-gray-200 bg-white md:sticky md:top-0 md:block md:h-screen">
          <div className="border-b border-gray-200 p-5">
            <div className="text-2xl font-semibold text-gray-900">TradeOS</div>
            <div className="text-sm text-gray-500">Business Management</div>
          </div>
          <nav className="h-[calc(100vh-89px)] overflow-y-auto p-3">
            {visibleNavigationItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSectionChange(item.id)}
                className={`mb-1 w-full rounded px-3 py-2 text-left text-sm transition ${
                  activeSection === item.id
                    ? "bg-blue-600 font-medium text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-3 px-4 py-3 md:hidden">
              <div>
                <div className="text-lg font-semibold text-gray-900">TradeOS</div>
                <div className="text-xs text-gray-500">Business Management</div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen((open) => !open)}
                className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
              >
                Menu
              </button>
            </div>

            {mobileMenuOpen && (
              <nav className="border-t border-gray-200 bg-white p-3 md:hidden">
                <div className="grid gap-2 sm:grid-cols-2">
                  {visibleNavigationItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSectionChange(item.id)}
                      className={`rounded px-3 py-2 text-left text-sm ${
                        activeSection === item.id
                          ? "bg-blue-600 font-medium text-white"
                          : "bg-gray-50 text-gray-700"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </nav>
            )}

            <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">{activeSectionLabel}</h1>
                <div className="mt-1 text-sm text-gray-500">
                  {organizationDisplayName} · {currentProfile?.full_name ?? currentUser.email}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {authMessage && <span className="text-sm text-green-700">{authMessage}</span>}
                {authError && <span className="text-sm text-red-700">{authError}</span>}
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={authLoading}
                  className="rounded bg-red-600 px-4 py-2 text-sm text-white transition hover:bg-red-700 disabled:bg-red-300"
                >
                  {authLoading ? "Processing..." : "Logout"}
                </button>
              </div>
            </div>
          </header>

          <div id="tradeos-main-content" className="h-[calc(100vh-129px)] overflow-y-auto px-4 py-6 md:h-[calc(100vh-97px)] md:px-6">
            <div className="mx-auto max-w-7xl">

        {!activeSectionAllowed && (
        <section className="rounded border border-red-200 bg-red-50 p-5">
          <h2 className="text-xl font-medium text-red-950">Permission Required</h2>
          <p className="mt-2 text-sm text-red-800">
            You do not have permission to view this section. Contact the owner.
          </p>
        </section>
        )}

        {activeSection === "dashboard" && (
        <>
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

          <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4">
            <h3 className="mb-3 text-lg font-medium text-amber-950">Reorder Summary</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded border border-amber-200 bg-white p-3">
                <div className="text-sm text-amber-700">Out of Stock</div>
                <div className="mt-1 text-2xl font-semibold text-amber-950">
                  {reorderRecommendationSummary.outOfStockCount}
                </div>
              </div>
              <div className="rounded border border-amber-200 bg-white p-3">
                <div className="text-sm text-amber-700">Urgent Reorder</div>
                <div className="mt-1 text-2xl font-semibold text-amber-950">
                  {reorderRecommendationSummary.urgentReorderCount}
                </div>
              </div>
              <div className="rounded border border-amber-200 bg-white p-3">
                <div className="text-sm text-amber-700">Low Stock Soon</div>
                <div className="mt-1 text-2xl font-semibold text-amber-950">
                  {reorderRecommendationSummary.lowStockSoonCount}
                </div>
              </div>
              <div className="rounded border border-amber-200 bg-white p-3">
                <div className="text-sm text-amber-700">No Reorder Level</div>
                <div className="mt-1 text-2xl font-semibold text-amber-950">
                  {reorderRecommendationSummary.missingReorderLevelCount}
                </div>
              </div>
            </div>
          </div>

          {isOwnerOrAdmin() && (
          <div className="mt-6 rounded border border-emerald-200 bg-emerald-50 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-medium text-emerald-950">Market Intelligence</h3>
                <p className="mt-1 text-sm text-emerald-900">
                  Track manual business signals for pricing, supply, inventory, and cashflow.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleSectionChange("market-intelligence")}
                className="rounded border border-emerald-600 bg-white px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50"
              >
                Open Market Intelligence
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <div className="rounded border border-emerald-200 bg-white p-3">
                <div className="text-sm text-emerald-700">High Impact Signals</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-950">{marketIntelligenceSummary.highCritical}</div>
              </div>
              <div className="rounded border border-emerald-200 bg-white p-3">
                <div className="text-sm text-emerald-700">Price-Up Signals</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-950">{marketIntelligenceSummary.priceUp}</div>
              </div>
              <div className="rounded border border-emerald-200 bg-white p-3">
                <div className="text-sm text-emerald-700">Supply Shortage Signals</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-950">{marketIntelligenceSummary.supplyShortage}</div>
              </div>
              <div className="rounded border border-emerald-200 bg-white p-3">
                <div className="text-sm text-emerald-700">Pending Imports</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-950">{marketImportQueueSummary.pending}</div>
              </div>
              <div className="rounded border border-emerald-200 bg-white p-3">
                <div className="text-sm text-emerald-700">Reviewing Imports</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-950">{marketImportQueueSummary.reviewing}</div>
              </div>
              <div className="rounded border border-emerald-200 bg-white p-3">
                <div className="text-sm text-emerald-700">AI Draft Analyses</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-950">{marketAiAnalysisSummary.draft}</div>
              </div>
              <div className="rounded border border-emerald-200 bg-white p-3">
                <div className="text-sm text-emerald-700">High Impact AI</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-950">{marketAiAnalysisSummary.high}</div>
              </div>
              <div className="rounded border border-emerald-200 bg-white p-3">
                <div className="text-sm text-emerald-700">Critical AI</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-950">{marketAiAnalysisSummary.critical}</div>
              </div>
            </div>
          </div>
          )}

          {hasPermission("can_manage_tasks") && (
          <div className="mt-6 rounded border border-blue-200 bg-blue-50 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-medium text-blue-950">Task Manager Summary</h3>
              <button
                type="button"
                onClick={() => handleSectionChange("task-manager")}
                className="rounded border border-blue-600 bg-white px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
              >
                Open Task Manager
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded border border-blue-200 bg-white p-3">
                <div className="text-sm text-blue-700">Pending Tasks</div>
                <div className="mt-1 text-2xl font-semibold text-blue-950">{taskDashboardSummary.pending}</div>
              </div>
              <div className="rounded border border-blue-200 bg-white p-3">
                <div className="text-sm text-blue-700">Overdue Tasks</div>
                <div className="mt-1 text-2xl font-semibold text-blue-950">{taskDashboardSummary.overdue}</div>
              </div>
              <div className="rounded border border-blue-200 bg-white p-3">
                <div className="text-sm text-blue-700">Due Today</div>
                <div className="mt-1 text-2xl font-semibold text-blue-950">{taskDashboardSummary.dueToday}</div>
              </div>
              <div className="rounded border border-blue-200 bg-white p-3">
                <div className="text-sm text-blue-700">Urgent Tasks</div>
                <div className="mt-1 text-2xl font-semibold text-blue-950">{taskDashboardSummary.urgent}</div>
              </div>
            </div>
            <div className="mt-4 rounded border border-blue-200 bg-white p-3">
              <h4 className="mb-2 text-sm font-medium text-blue-950">Next Tasks</h4>
              {nextDashboardTasks.length === 0 ? (
                <p className="text-sm text-gray-600">No pending or in-progress tasks.</p>
              ) : (
                <ul className="space-y-2">
                  {nextDashboardTasks.map((task) => (
                    <li key={task.id} className="flex flex-col gap-1 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{task.title}</div>
                        <div className="text-xs text-gray-500">
                          {taskStatusLabels[task.status] ?? task.status} · Due {getDateOnly(task.due_date) ?? "No due date"}
                        </div>
                      </div>
                      <span className="text-xs font-medium text-blue-700">
                        {taskPriorityLabels[task.priority] ?? task.priority}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          )}

          {isOwnerOrAdmin() && (
          <div className="mt-6 rounded border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-medium text-slate-950">Recent Activity</h3>
              <button
                type="button"
                onClick={() => handleSectionChange("activity-logs")}
                className="rounded border border-slate-600 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                View All Activity
              </button>
            </div>
            {recentAuditLogs.length === 0 ? (
              <p className="text-sm text-gray-600">No activity logs recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {recentAuditLogs.map((log) => (
                  <li key={log.id} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <span className="font-medium capitalize text-slate-900">{log.action}</span>
                        <span className="text-slate-500"> {log.entity_type.replace(/_/g, " ")}</span>
                        {log.entity_label && <span className="text-slate-700"> - {log.entity_label}</span>}
                      </div>
                      <span className="text-xs text-slate-500">{formatDate(log.created_at)}</span>
                    </div>
                    {log.description && <p className="mt-1 text-xs text-slate-600">{log.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}

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
        </>
        )}

        {activeSectionAllowed && activeSection === "profit-loss" && (
        <section className="mb-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-medium text-gray-900">Profit Dashboard</h2>
            <button
              type="button"
              onClick={handleExportProfitLossCsv}
              className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
            >
              Export P&amp;L CSV
            </button>
          </div>

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
        )}

        {activeSectionAllowed && activeSection === "brands" && (
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
        )}

        {activeSectionAllowed && activeSection === "inventory" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-medium text-gray-900">Inventory Dashboard</h2>
            <button
              type="button"
              onClick={handleExportInventoryCsv}
              className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
            >
              Export Inventory CSV
            </button>
          </div>
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

          <div className="mt-6 rounded border border-gray-200 bg-white p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h3 className="text-lg font-medium text-gray-900">Inventory Reorder Recommendations</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:w-[520px]">
                <select
                  value={reorderRecommendationFilter}
                  onChange={(e) => setReorderRecommendationFilter(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="Out of Stock">Out of Stock</option>
                  <option value="Urgent Reorder">Urgent Reorder</option>
                  <option value="Low Stock Soon">Low Stock Soon</option>
                  <option value="Healthy">Healthy</option>
                  <option value="missing-reorder-level">Missing Reorder Level</option>
                </select>
                <input
                  type="search"
                  value={reorderRecommendationSearch}
                  onChange={(e) => setReorderRecommendationSearch(e.target.value)}
                  placeholder="Search product, brand, category"
                  className="rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {filteredReorderRecommendations.length === 0 ? (
              <p className="text-sm text-gray-600">No reorder recommendations match the current filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Current Stock</th>
                      <th className="px-3 py-2">Reorder Level</th>
                      <th className="px-3 py-2">Recent 30-day Sales</th>
                      <th className="px-3 py-2">Daily Avg</th>
                      <th className="px-3 py-2">Days Left</th>
                      <th className="px-3 py-2">Suggested Reorder</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredReorderRecommendations.map((recommendation) => (
                      <tr key={recommendation.productId}>
                        <td className="px-3 py-3">
                          <div className="font-medium text-gray-900">{recommendation.productName}</div>
                          <div className="text-xs text-gray-500">
                            {recommendation.brandName || "No brand"} · {recommendation.categoryName || "No category"}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {recommendation.currentStock} {recommendation.unitType}
                        </td>
                        <td className="px-3 py-3">
                          {recommendation.reorderLevel > 0
                            ? `${recommendation.reorderLevel} ${recommendation.unitType}`
                            : "Set reorder level first"}
                        </td>
                        <td className="px-3 py-3">
                          {recommendation.recentSalesQuantity} {recommendation.unitType}
                        </td>
                        <td className="px-3 py-3">
                          {recommendation.dailyAverageSales > 0
                            ? `${recommendation.dailyAverageSales.toFixed(2)} ${recommendation.unitType}/day`
                            : "No recent sales"}
                        </td>
                        <td className="px-3 py-3">
                          {recommendation.estimatedDaysLeft === null
                            ? "No recent sales"
                            : `${Math.max(0, recommendation.estimatedDaysLeft).toFixed(1)} days`}
                        </td>
                        <td className="px-3 py-3">
                          {recommendation.reorderLevel > 0
                            ? `${recommendation.suggestedReorderQuantity} ${recommendation.unitType}`
                            : "Set reorder level first"}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded px-2 py-1 text-xs font-medium ${
                              recommendation.status === "Out of Stock"
                                ? "bg-red-100 text-red-700"
                                : recommendation.status === "Urgent Reorder"
                                  ? "bg-orange-100 text-orange-700"
                                  : recommendation.status === "Low Stock Soon"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-green-100 text-green-700"
                            }`}
                          >
                            {recommendation.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "sales" && (
        <>
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
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="font-medium text-gray-900">Invoice: {tx.invoice_number}</div>
                      <button
                        type="button"
                        onClick={() => handlePrintSalesInvoice(tx)}
                        className="rounded border border-blue-600 px-3 py-1 text-xs text-blue-600 hover:bg-blue-50"
                      >
                        Print Invoice
                      </button>
                    </div>
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
        </>
        )}

        {activeSectionAllowed && activeSection === "customer-payments" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-xl font-medium text-gray-900">Customer Payments</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExportCustomerBalancesCsv}
                className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
              >
                Export Customer Balances CSV
              </button>
              <button
                type="button"
                onClick={() => handlePrintCustomerStatement(selectedCustomerPaymentId)}
                disabled={!selectedCustomerPaymentId}
                className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
              >
                Print Customer Statement
              </button>
            </div>
          </div>
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
        )}

        {activeSectionAllowed && activeSection === "supplier-payments" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-medium text-gray-900">Supplier Payments</h2>
            <button
              type="button"
              onClick={handleExportSupplierBalancesCsv}
              className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
            >
              Export Supplier Balances CSV
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <select
              value={selectedSupplierPaymentId ?? ""}
              onChange={(e) => handleSupplierPaymentSupplierChange(e.target.value)}
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
              onChange={(e) => handleSupplierPaymentAmountChange(e.target.value)}
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

          {selectedSupplierPaymentId && (
            <div className="mt-4 rounded border border-gray-200 bg-white p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-medium text-gray-900">Allocate to Purchase Invoices</h3>
                <button
                  type="button"
                  onClick={handleAutoAllocateSupplierPayment}
                  className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
                >
                  Auto Allocate Oldest First
                </button>
              </div>
              <p className="mb-3 text-xs text-gray-500">
                Older supplier payments without invoice allocations are applied to the oldest unpaid purchase invoices first.
              </p>

              <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-gray-500">Payment Amount</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(Number.isFinite(supplierPaymentAmountValue) ? supplierPaymentAmountValue : 0)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-gray-500">Total Allocated</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(supplierPaymentAllocationTotal)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-gray-500">Unallocated Amount</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(supplierPaymentUnallocatedAmount)}
                  </div>
                </div>
              </div>

              {unpaidPurchaseInvoicesForSelectedPaymentSupplier.length === 0 ? (
                <p className="text-sm text-gray-600">No unpaid purchase invoices for this supplier.</p>
              ) : (
                <div className="space-y-3">
                  {unpaidPurchaseInvoicesForSelectedPaymentSupplier.map((invoice) => (
                    <div key={invoice.transaction.id} className="rounded border border-gray-200 bg-gray-50 p-3">
                      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Invoice</div>
                          <div className="font-medium text-gray-900">{invoice.transaction.invoice_number}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Purchase Date</div>
                          <div>{invoice.purchaseDate ?? "-"}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Supplier</div>
                          <div>{invoice.supplier?.supplier_name ?? "Unknown"}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Purchase Total</div>
                          <div>{pkrFormatter.format(invoice.purchaseTotal)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Already Allocated</div>
                          <div>{pkrFormatter.format(invoice.explicitAllocatedAmount)}</div>
                          {invoice.fallbackAllocatedAmount > 0 && (
                            <div className="text-xs text-gray-500">
                              Remaining also reflects {pkrFormatter.format(invoice.fallbackAllocatedAmount)} older unallocated payment
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-gray-500">Remaining Payable</div>
                          <div>{pkrFormatter.format(invoice.remainingPayableAmount)}</div>
                        </div>
                        <label className="flex flex-col gap-1 text-xs text-gray-700">
                          <span>Allocation Amount</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={supplierPaymentAllocationsByInvoice[invoice.transaction.id] ?? ""}
                            onChange={(e) =>
                              handleSupplierPaymentAllocationChange(invoice.transaction.id, e.target.value)
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
              onClick={handleSaveSupplierPayment}
              disabled={supplierPaymentLoading}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {supplierPaymentLoading ? "Saving..." : "Save Supplier Payment"}
            </button>
            {supplierPaymentMessage && <p className="mt-2 text-sm text-green-700">{supplierPaymentMessage}</p>}
            {supplierPaymentError && <p className="mt-2 text-sm text-red-700">{supplierPaymentError}</p>}
          </div>

          <div className="mt-6 border-t border-gray-200 pt-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Supplier Payment History</h3>
            {supplierPaymentHistory.length === 0 ? (
              <p className="text-sm text-gray-600">No supplier payments recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {supplierPaymentHistory.map((historyItem) => (
                  <li
                    key={historyItem.payment.id}
                    className="rounded border border-gray-200 bg-white p-3 text-sm text-gray-700"
                  >
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-500">Supplier</div>
                        <div className="font-medium text-gray-900">
                          {historyItem.supplier?.supplier_name ?? "Unknown"}
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
                                Purchase invoice: {allocationItem.transaction?.invoice_number ?? "Unknown"}
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
        )}

        {activeSectionAllowed && activeSection === "supplier-ledger" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-medium text-gray-900">Supplier Ledger</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExportSupplierBalancesCsv}
                className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
              >
                Export Supplier Balances CSV
              </button>
              <button
                type="button"
                onClick={handlePrintSupplierLedger}
                disabled={!selectedSupplierLedgerId}
                className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
              >
                Print Supplier Ledger
              </button>
            </div>
          </div>
          <p className="mb-4 text-xs text-gray-500">
            Older supplier payments without invoice allocations are applied to the oldest unpaid purchase invoices first.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Supplier</span>
              <select
                value={selectedSupplierLedgerId}
                onChange={(e) => setSelectedSupplierLedgerId(e.target.value)}
                className="rounded border border-gray-300 px-2 py-2"
              >
                <option value="">Select Supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Start Date</span>
              <input
                type="date"
                value={supplierLedgerStartDate}
                onChange={(e) => handleSupplierLedgerStartDateChange(e.target.value)}
                className="rounded border border-gray-300 px-2 py-2"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>End Date</span>
              <input
                type="date"
                value={supplierLedgerEndDate}
                onChange={(e) => handleSupplierLedgerEndDateChange(e.target.value)}
                className="rounded border border-gray-300 px-2 py-2"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applySupplierLedgerMonthRange(0)}
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white"
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => applySupplierLedgerMonthRange(-1)}
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white"
            >
              Last Month
            </button>
            <button
              type="button"
              onClick={applySupplierLedgerAllTime}
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white"
            >
              All Time
            </button>
          </div>

          {supplierLedgerDateError && (
            <p className="mt-2 text-sm text-red-700">{supplierLedgerDateError}</p>
          )}

          {!selectedSupplierLedgerId ? (
            <p className="mt-4 text-sm text-gray-600">Select a supplier to view the ledger.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="text-gray-500">Total Purchases</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(supplierLedgerTotalPurchases)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="text-gray-500">Total Payments</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(supplierLedgerTotalPayments)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="text-gray-500">Current Ledger Balance</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(supplierLedgerCurrentBalance)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="text-gray-500">Unallocated Payments</div>
                  <div className="font-medium text-gray-900">
                    {pkrFormatter.format(supplierLedgerUnallocatedPayments)}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-gray-200 bg-white">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">Notes</th>
                      <th className="px-3 py-2">Debit</th>
                      <th className="px-3 py-2">Credit</th>
                      <th className="px-3 py-2">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    <tr>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2 font-medium text-gray-900">Opening balance</td>
                      <td className="px-3 py-2">MVP opening balance</td>
                      <td className="px-3 py-2">{pkrFormatter.format(0)}</td>
                      <td className="px-3 py-2">{pkrFormatter.format(0)}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{pkrFormatter.format(0)}</td>
                    </tr>
                    {supplierLedgerEntries.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-gray-600" colSpan={6}>
                          No supplier ledger entries in this date range.
                        </td>
                      </tr>
                    ) : (
                      supplierLedgerEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="px-3 py-2">{entry.date ?? "-"}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">{entry.reference}</td>
                          <td className="px-3 py-2">{entry.notes || "-"}</td>
                          <td className="px-3 py-2">{pkrFormatter.format(entry.debit)}</td>
                          <td className="px-3 py-2">{pkrFormatter.format(entry.credit)}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {pkrFormatter.format(entry.runningBalance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
        )}

        {activeSectionAllowed && activeSection === "expenses" && (
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
        )}

        {activeSectionAllowed && activeSection === "customer-credit" && (
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
        )}

        {activeSectionAllowed && activeSection === "supplier-ledger" && (
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
        )}

        {activeSectionAllowed && activeSection === "categories" && (
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
        )}

        {activeSectionAllowed && activeSection === "products" && (
        <>
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
        </>
        )}

        {activeSectionAllowed && activeSection === "customers" && (
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
        )}

        {activeSectionAllowed && activeSection === "suppliers" && (
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
        )}

        {activeSectionAllowed && activeSection === "purchases" && (
        <>
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
                const supplierPaymentSummary =
                  supplierPaymentAllocationByPurchaseTransaction[transaction.id];
                const purchasePaymentTotal =
                  supplierPaymentSummary?.purchaseTotal ?? purchaseValue;
                const purchasePaidAmount = supplierPaymentSummary?.paidAmount ?? 0;
                const purchaseRemainingPayable =
                  supplierPaymentSummary?.remainingPayableAmount ?? purchasePaymentTotal;
                const purchasePaymentStatus =
                  purchaseRemainingPayable <= 0
                    ? "Paid"
                    : purchasePaidAmount > 0
                      ? "Partially Paid"
                      : "Unpaid";

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

                    <div className="mb-3 rounded border border-emerald-100 bg-emerald-50 p-3">
                      <h3 className="mb-2 text-sm font-medium text-emerald-950">Payment Summary</h3>
                      <div className="grid gap-2 text-xs text-emerald-950 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <div className="uppercase tracking-wide text-emerald-700">Purchase Total</div>
                          <div className="font-medium">{pkrFormatter.format(purchasePaymentTotal)}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wide text-emerald-700">Paid Amount</div>
                          <div className="font-medium">{pkrFormatter.format(purchasePaidAmount)}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wide text-emerald-700">Remaining Payable</div>
                          <div className="font-medium">{pkrFormatter.format(Math.max(0, purchaseRemainingPayable))}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wide text-emerald-700">Payment Status</div>
                          <div className="font-medium">{purchasePaymentStatus}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <button
                        type="button"
                        onClick={() => handlePrintPurchaseInvoice(transaction)}
                        className="rounded border border-blue-600 px-3 py-2 text-xs text-blue-600 hover:bg-blue-50"
                      >
                        Print Purchase
                      </button>
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
        </>
        )}

        {activeSectionAllowed && activeSection === "staff-permissions" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-medium text-gray-900">Staff & Permissions</h2>
              <p className="mt-1 text-sm text-gray-600">Manage staff roles, account status, and module access.</p>
            </div>
            <button
              type="button"
              onClick={() => fetchStaffProfilesAndPermissions(currentOrganizationId)}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Refresh Staff
            </button>
          </div>

          <div className="mb-5 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Staff invite by email will be added later. For now, staff accounts can be managed after they sign up under this organization.
          </div>

          <div className="mb-5 rounded border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="text-lg font-medium text-emerald-950">Security Readiness</h3>
            <div className="mt-3 grid gap-2 text-sm text-emerald-900 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Organization ID loaded: {currentOrganizationId ? "Yes" : "No"}
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Current profile loaded: {currentProfile ? "Yes" : "No"}
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Staff permissions loaded: {Array.isArray(staffPermissions) ? "Yes" : "No"}
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                RLS Phase 1 app guards active: Yes
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Auth user linked to profile: {currentProfile?.auth_user_id ? "Pass" : "Needs link"}
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Security policy backup table: Manual SQL completed
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Security helper functions: Created in Supabase
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                RLS Phase 2B direct table policies applied: Yes
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Direct organization-owned tables protected: Yes
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                RLS Phase 2C child table policies applied: Yes
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Purchase items protected through purchase invoice organization: Yes
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Sales items protected through sales invoice organization: Yes
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2 lg:col-span-2">
                Payment allocation rows protected through parent payment/invoice organization: Yes
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                PWA/mobile readiness added: Yes
              </div>
              <div className="rounded border border-emerald-200 bg-white px-3 py-2">
                Staff duty location tracking V1 added: Yes
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 lg:col-span-3">
                Remaining security task: final cross-organization testing.
              </div>
              <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900 lg:col-span-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>Final Security Test Mode available.</span>
                  <button
                    type="button"
                    onClick={() => handleSectionChange("security-check")}
                    className="rounded border border-blue-600 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
                  >
                    Open Security Check
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSectionChange("deployment")}
                    className="rounded border border-blue-600 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
                  >
                    Open Deployment Readiness
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSectionChange("mobile-app")}
                    className="rounded border border-blue-600 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
                  >
                    Open Mobile App
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSectionChange("staff-duty")}
                    className="rounded border border-blue-600 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
                  >
                    Open Staff Duty
                  </button>
                </div>
              </div>
            </div>
          </div>

          {staffPermissionMessage && <p className="mb-4 text-sm text-green-700">{staffPermissionMessage}</p>}
          {staffPermissionError && <p className="mb-4 whitespace-pre-wrap text-sm text-red-700">{staffPermissionError}</p>}

          <div className="rounded border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Staff Profiles</h3>
            {staffProfiles.length === 0 ? (
              <p className="text-sm text-gray-600">No staff profiles found for this organization.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Staff</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Active</th>
                      <th className="px-3 py-2">Permission Summary</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {staffProfiles.map((profile) => {
                      const draft = staffProfileDrafts[profile.id] ?? {
                        display_name: profile.display_name ?? "",
                        role: profile.role ?? "staff",
                        is_active: profile.is_active !== false,
                      };
                      const profilePermissions = staffPermissions.find(
                        (permission) => permission.profile_id === profile.id
                      );
                      const activePermissionLabels = staffPermissionLabels
                        .filter((permission) => Boolean(profilePermissions?.[permission.key]))
                        .map((permission) => permission.label);
                      const profileIsOwnerOrAdmin = !profile.role || profile.role === "owner" || profile.role === "admin";

                      return (
                        <tr key={profile.id}>
                          <td className="min-w-[220px] px-3 py-3">
                            <input
                              type="text"
                              value={draft.display_name}
                              onChange={(e) => updateStaffProfileDraft(profile.id, "display_name", e.target.value)}
                              placeholder="Display name"
                              className="w-full rounded border border-gray-300 px-3 py-2"
                            />
                            <div className="mt-1 text-xs text-gray-500">{profile.email ?? "No email"}</div>
                            {currentProfile?.id === profile.id && (
                              <div className="mt-1 text-xs font-medium text-blue-700">Current user</div>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <select
                              value={draft.role}
                              onChange={(e) => updateStaffProfileDraft(profile.id, "role", e.target.value)}
                              className="rounded border border-gray-300 px-3 py-2"
                            >
                              {staffRoles.map((role) => (
                                <option key={role} value={role}>{role}</option>
                              ))}
                            </select>
                            {profileIsOwnerOrAdmin && (
                              <div className="mt-2 inline-flex rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-800">
                                Owner/Admin
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={draft.is_active}
                                onChange={(e) => updateStaffProfileDraft(profile.id, "is_active", e.target.checked)}
                              />
                              <span>{draft.is_active ? "Active" : "Inactive"}</span>
                            </label>
                          </td>
                          <td className="min-w-[260px] px-3 py-3 text-xs text-gray-600">
                            {profileIsOwnerOrAdmin ? (
                              <span>Full access</span>
                            ) : activePermissionLabels.length > 0 ? (
                              <span>{activePermissionLabels.join(", ")}</span>
                            ) : (
                              <span>No permissions selected</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedStaffProfileId(profile.id)}
                                className="rounded border border-blue-600 px-3 py-2 text-xs text-blue-700 hover:bg-blue-50"
                              >
                                Edit Permissions
                              </button>
                              <button
                                type="button"
                                onClick={() => saveStaffProfile(profile.id)}
                                className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700"
                              >
                                Save Profile
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Permissions</h3>
            <label className="flex max-w-xl flex-col gap-2 text-sm text-gray-700">
              <span>Select Staff Member</span>
              <select
                value={selectedStaffProfileId}
                onChange={(e) => setSelectedStaffProfileId(e.target.value)}
                className="rounded border border-gray-300 px-3 py-2"
              >
                <option value="">Select staff</option>
                {staffProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.display_name || profile.email || profile.id}
                  </option>
                ))}
              </select>
            </label>

            {(() => {
              const selectedProfile = staffProfiles.find((profile) => profile.id === selectedStaffProfileId);
              const selectedProfileIsOwner = selectedProfile?.role === "owner" || !selectedProfile?.role;

              if (!selectedProfile) {
                return <p className="mt-4 text-sm text-gray-600">Select a staff member to edit permissions.</p>;
              }

              return (
                <div className="mt-4">
                  {selectedProfileIsOwner && (
                    <div className="mb-4 rounded border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
                      Owners have full access. Permission checkboxes are mainly for non-owner staff.
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {staffPermissionLabels.map((permission) => (
                      <label key={permission.key} className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={Boolean(staffPermissionDraft[permission.key])}
                          onChange={(e) =>
                            setStaffPermissionDraft((current) => ({
                              ...current,
                              [permission.key]: e.target.checked,
                            }))
                          }
                        />
                        <span>{permission.label}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={saveStaffPermissions}
                    className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                  >
                    Save Permissions
                  </button>
                </div>
              );
            })()}
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "market-intelligence" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-medium text-gray-900">Market Intelligence</h2>
              <p className="mt-1 text-sm text-gray-600">
                Market Intelligence helps owners track news and business signals that may affect buying, selling, pricing, inventory, and cashflow. AI analysis and automated news ingestion will be added later.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                fetchMarketNewsSources(currentOrganizationId);
                fetchMarketIntelligenceItems(currentOrganizationId);
                fetchMarketImportQueueItems(currentOrganizationId);
                fetchMarketAiAnalyses(currentOrganizationId);
              }}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Refresh Market Data
            </button>
          </div>

          <div className="mb-5 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This is an owner-reviewed advisory dashboard. TradeOS does not fetch live news or scrape websites automatically.
            AI analysis can be wrong. Use it as advisory support, not automatic decision-making.
          </div>

          {marketIntelligenceMessage && (
            <p className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {marketIntelligenceMessage}
            </p>
          )}
          {marketIntelligenceError && (
            <p className="mb-4 whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {marketIntelligenceError}
            </p>
          )}
          {marketAiAnalysisMessage && (
            <p className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {marketAiAnalysisMessage}
            </p>
          )}
          {marketAiAnalysisError && (
            <p className="mb-4 whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {marketAiAnalysisError}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Active Items</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{marketIntelligenceSummary.active}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">High/Critical</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{marketIntelligenceSummary.highCritical}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Price-Up Signals</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{marketIntelligenceSummary.priceUp}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Supply Shortage</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{marketIntelligenceSummary.supplyShortage}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Added This Week</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{marketIntelligenceSummary.addedThisWeek}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">AI Draft Analyses</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{marketAiAnalysisSummary.draft}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">High Impact AI</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{marketAiAnalysisSummary.high}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Critical AI</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{marketAiAnalysisSummary.critical}</div>
            </div>
          </div>

          <div className="mt-5 rounded border border-indigo-200 bg-white p-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Import Queue</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Paste market news links, supplier updates, policy notes, or raw market observations here. Review them before converting into intelligence items.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-[260px]">
                <div className="rounded border border-indigo-200 bg-indigo-50 p-2">
                  <div className="text-indigo-700">Pending</div>
                  <div className="text-lg font-semibold text-indigo-950">{marketImportQueueSummary.pending}</div>
                </div>
                <div className="rounded border border-indigo-200 bg-indigo-50 p-2">
                  <div className="text-indigo-700">Reviewing</div>
                  <div className="text-lg font-semibold text-indigo-950">{marketImportQueueSummary.reviewing}</div>
                </div>
              </div>
            </div>
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This queue is owner-controlled. TradeOS does not fetch websites, scrape pages, or save intelligence items automatically.
            </div>

            {marketImportQueueMessage && (
              <p className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                {marketImportQueueMessage}
              </p>
            )}
            {marketImportQueueError && (
              <p className="mt-3 whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {marketImportQueueError}
              </p>
            )}

            <form onSubmit={createMarketImportQueueItem} className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
              <h4 className="text-base font-medium text-gray-900">Add Import Queue Item</h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {marketImportQueueExampleChips.map((example) => (
                  <button
                    key={example.raw_title}
                    type="button"
                    onClick={() => fillMarketImportExample(example)}
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-800 hover:bg-indigo-100"
                  >
                    {example.raw_title}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Source Name</span>
                  <input value={marketImportSourceName} onChange={(e) => setMarketImportSourceName(e.target.value)} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Source URL</span>
                  <input value={marketImportSourceUrl} onChange={(e) => setMarketImportSourceUrl(e.target.value)} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Raw Title</span>
                  <input value={marketImportRawTitle} onChange={(e) => setMarketImportRawTitle(e.target.value)} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Suggested Market Category</span>
                  <select value={marketImportSuggestedCategory} onChange={(e) => setMarketImportSuggestedCategory(e.target.value)} className="rounded border border-gray-300 px-3 py-2">
                    <option value="">Not suggested</option>
                    {marketCategoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700 sm:col-span-2">
                  <span>Raw Summary</span>
                  <textarea value={marketImportRawSummary} onChange={(e) => setMarketImportRawSummary(e.target.value)} rows={2} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700 sm:col-span-2">
                  <span>Raw Text / Notes</span>
                  <textarea value={marketImportRawText} onChange={(e) => setMarketImportRawText(e.target.value)} rows={3} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Suggested Impact Direction</span>
                  <select value={marketImportSuggestedImpactDirection} onChange={(e) => setMarketImportSuggestedImpactDirection(e.target.value)} className="rounded border border-gray-300 px-3 py-2">
                    <option value="">Not suggested</option>
                    {marketImpactDirectionOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Suggested Impact Level</span>
                  <select value={marketImportSuggestedImpactLevel} onChange={(e) => setMarketImportSuggestedImpactLevel(e.target.value)} className="rounded border border-gray-300 px-3 py-2">
                    <option value="">Not suggested</option>
                    {marketImpactLevelOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Suggested Confidence</span>
                  <select value={marketImportSuggestedConfidenceLevel} onChange={(e) => setMarketImportSuggestedConfidenceLevel(e.target.value)} className="rounded border border-gray-300 px-3 py-2">
                    <option value="">Not suggested</option>
                    {marketConfidenceOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Suggested Affected Area</span>
                  <select value={marketImportSuggestedAffectedArea} onChange={(e) => setMarketImportSuggestedAffectedArea(e.target.value)} className="rounded border border-gray-300 px-3 py-2">
                    <option value="">Not suggested</option>
                    {marketAffectedAreaOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700 sm:col-span-2">
                  <span>Suggested Action</span>
                  <textarea value={marketImportSuggestedAction} onChange={(e) => setMarketImportSuggestedAction(e.target.value)} rows={2} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700 sm:col-span-2">
                  <span>Internal Notes</span>
                  <textarea value={marketImportNotes} onChange={(e) => setMarketImportNotes(e.target.value)} rows={2} className="rounded border border-gray-300 px-3 py-2" />
                </label>
              </div>
              <button type="submit" className="mt-4 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
                Add to Import Queue
              </button>
            </form>

            <div className="mt-5 rounded border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h4 className="text-base font-medium text-gray-900">Queued Imports</h4>
                  <p className="mt-1 text-sm text-gray-600">
                    Showing {filteredMarketImportQueueItems.length} of {marketImportQueueItems.length} queued imports.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[420px]">
                  <input
                    type="search"
                    value={marketImportQueueSearch}
                    onChange={(e) => setMarketImportQueueSearch(e.target.value)}
                    placeholder="Search queue"
                    className="rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                  <select value={marketImportQueueStatusFilter} onChange={(e) => setMarketImportQueueStatusFilter(e.target.value)} className="rounded border border-gray-300 px-3 py-2 text-sm">
                    <option value="all">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="reviewing">Reviewing</option>
                    <option value="converted">Converted</option>
                    <option value="ignored">Ignored</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {filteredMarketImportQueueItems.length === 0 ? (
                  <p className="rounded border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
                    No import queue items match the current filters.
                  </p>
                ) : (
                  filteredMarketImportQueueItems.map((item) => (
                    <div key={item.id} className="rounded border border-gray-200 bg-white p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-800">
                              {item.review_status}
                            </span>
                            {item.suggested_market_category && (
                              <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                {getMarketLabel(marketCategoryOptions, item.suggested_market_category)}
                              </span>
                            )}
                            {item.suggested_impact_direction && (
                              <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                                {getMarketLabel(marketImpactDirectionOptions, item.suggested_impact_direction)}
                              </span>
                            )}
                          </div>
                          <h5 className="mt-2 text-sm font-semibold text-gray-900">{item.raw_title || "Untitled import"}</h5>
                          <div className="mt-1 text-xs text-gray-600">
                            Source: {item.source_name || "Manual note"} · Created: {formatDateTime(item.created_at)}
                          </div>
                          {item.source_url && <div className="mt-1 break-all text-xs text-blue-700">{item.source_url}</div>}
                          {item.raw_summary && <p className="mt-2 text-sm text-gray-700">{item.raw_summary}</p>}
                          {item.raw_text && (
                            <p className="mt-2 text-xs text-gray-600">
                              {item.raw_text.length > 220 ? `${item.raw_text.slice(0, 220)}...` : item.raw_text}
                            </p>
                          )}
                          <div className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                            <div>Impact: {getMarketLabel(marketImpactLevelOptions, item.suggested_impact_level)}</div>
                            <div>Confidence: {getMarketLabel(marketConfidenceOptions, item.suggested_confidence_level)}</div>
                            <div>Affected area: {getMarketLabel(marketAffectedAreaOptions, item.suggested_affected_area)}</div>
                            <div>Converted item: {item.converted_intelligence_item_id ?? "-"}</div>
                            <div>Reviewed: {formatDateTime(item.reviewed_at)}</div>
                            <div>Updated: {formatDateTime(item.updated_at)}</div>
                          </div>
                          {item.suggested_action && (
                            <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                              Suggested action: {item.suggested_action}
                            </div>
                          )}
                          {item.notes && <div className="mt-2 text-xs text-gray-600">Notes: {item.notes}</div>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => analyzeMarketImportQueueItem(item)}
                            disabled={marketAiAnalysisLoadingId === `queue-${item.id}` || item.review_status === "converted"}
                            className="rounded border border-purple-500 bg-white px-3 py-2 text-xs text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            {marketAiAnalysisLoadingId === `queue-${item.id}` ? "Analyzing..." : "Analyze with AI"}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMarketImportQueueStatus(item, "reviewing")}
                            disabled={item.review_status === "reviewing" || item.review_status === "converted"}
                            className="rounded border border-indigo-500 bg-white px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            Mark Reviewing
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMarketImportQueueStatus(item, "ignored")}
                            disabled={item.review_status === "ignored" || item.review_status === "converted"}
                            className="rounded border border-gray-500 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            Ignore
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMarketImportQueueStatus(item, "pending")}
                            disabled={item.review_status === "pending" || item.review_status === "converted"}
                            className="rounded border border-amber-500 bg-white px-3 py-2 text-xs text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            Reopen Pending
                          </button>
                          <button
                            type="button"
                            onClick={() => convertMarketImportQueueItem(item)}
                            disabled={item.review_status === "converted"}
                            className="rounded bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            Convert to Intelligence Item
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 rounded border border-purple-200 bg-white p-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">AI Analysis Reviews</h3>
                <p className="mt-1 text-sm text-gray-600">
                  AI analysis is advisory. Owner should review before taking action.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs sm:min-w-[300px]">
                <div className="rounded border border-purple-200 bg-purple-50 p-2">
                  <div className="text-purple-700">Draft</div>
                  <div className="text-lg font-semibold text-purple-950">{marketAiAnalysisSummary.draft}</div>
                </div>
                <div className="rounded border border-purple-200 bg-purple-50 p-2">
                  <div className="text-purple-700">High</div>
                  <div className="text-lg font-semibold text-purple-950">{marketAiAnalysisSummary.high}</div>
                </div>
                <div className="rounded border border-purple-200 bg-purple-50 p-2">
                  <div className="text-purple-700">Critical</div>
                  <div className="text-lg font-semibold text-purple-950">{marketAiAnalysisSummary.critical}</div>
                </div>
              </div>
            </div>
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              AI analysis can be wrong. Use it as advisory support, not automatic decision-making.
            </div>
            <div className="mt-4 space-y-3">
              {marketAiAnalyses.length === 0 ? (
                <p className="rounded border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  No AI analyses created yet. Use Analyze with AI on an import queue item or market intelligence item.
                </p>
              ) : (
                marketAiAnalyses.map((analysis) => (
                  <div key={analysis.id} className="rounded border border-purple-100 bg-purple-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded bg-purple-700 px-2 py-1 text-xs font-medium text-white">
                            {analysis.review_status}
                          </span>
                          <span className="rounded bg-white px-2 py-1 text-xs font-medium text-purple-800">
                            {getMarketLabel(marketCategoryOptions, analysis.ai_market_category)}
                          </span>
                          <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                            {getMarketLabel(marketImpactDirectionOptions, analysis.ai_impact_direction)}
                          </span>
                          <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                            {getMarketLabel(marketImpactLevelOptions, analysis.ai_impact_level)}
                          </span>
                        </div>
                        <h4 className="mt-2 text-base font-semibold text-gray-900">
                          {analysis.input_title || analysis.ai_summary || "AI market analysis"}
                        </h4>
                        <div className="mt-1 text-xs text-gray-600">
                          Source: {analysis.input_source_name || "Manual note"} - Created: {formatDateTime(analysis.created_at)}
                        </div>
                        {analysis.input_source_url && <div className="mt-1 break-all text-xs text-blue-700">{analysis.input_source_url}</div>}
                        {analysis.ai_summary && <p className="mt-2 text-sm text-gray-800">{analysis.ai_summary}</p>}
                        {analysis.ai_reasoning && (
                          <div className="mt-2 rounded border border-purple-100 bg-white px-3 py-2 text-sm text-gray-700">
                            Reasoning: {analysis.ai_reasoning}
                          </div>
                        )}
                        <div className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                          <div>Confidence: {getMarketLabel(marketConfidenceOptions, analysis.ai_confidence_level)}</div>
                          <div>Affected area: {getMarketLabel(marketAffectedAreaOptions, analysis.ai_affected_area)}</div>
                          <div>Reviewed: {formatDateTime(analysis.reviewed_at)}</div>
                          <div>Import queue: {analysis.market_import_queue_id ?? "-"}</div>
                          <div>Market item: {analysis.market_intelligence_item_id ?? "-"}</div>
                          <div>Converted item: {analysis.converted_intelligence_item_id ?? "-"}</div>
                        </div>
                        {analysis.ai_suggested_action && (
                          <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                            Suggested action: {analysis.ai_suggested_action}
                          </div>
                        )}
                        {analysis.ai_risks && <div className="mt-2 text-xs text-red-700">Risks: {analysis.ai_risks}</div>}
                        {analysis.ai_owner_questions && <div className="mt-1 text-xs text-gray-700">Owner questions: {analysis.ai_owner_questions}</div>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => convertMarketAiAnalysisToIntelligenceItem(analysis)}
                          disabled={analysis.review_status === "converted"}
                          className="rounded bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                        >
                          Use as Intelligence Item
                        </button>
                        <button
                          type="button"
                          onClick={() => updateMarketAiAnalysisStatus(analysis, "reviewed")}
                          disabled={analysis.review_status === "reviewed" || analysis.review_status === "converted"}
                          className="rounded border border-blue-500 bg-white px-3 py-2 text-xs text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                        >
                          Mark Reviewed
                        </button>
                        <button
                          type="button"
                          onClick={() => updateMarketAiAnalysisStatus(analysis, "ignored")}
                          disabled={analysis.review_status === "ignored" || analysis.review_status === "converted"}
                          className="rounded border border-gray-500 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                        >
                          Ignore
                        </button>
                        <button
                          type="button"
                          onClick={() => updateMarketAiAnalysisStatus(analysis, "draft")}
                          disabled={analysis.review_status === "draft" || analysis.review_status === "converted"}
                          className="rounded border border-purple-500 bg-white px-3 py-2 text-xs text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                        >
                          Reopen Draft
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
            <form id="market-intelligence-item-form" onSubmit={createMarketIntelligenceItem} className="rounded border border-gray-200 bg-white p-4">
              <h3 className="text-lg font-medium text-gray-900">Add Intelligence Item</h3>
              {selectedAiAnalysisId && (
                <p className="mt-2 rounded border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-900">
                  This form is prefilled from an AI analysis. Review details before saving.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {marketIntelligenceExampleChips.map((example) => (
                  <button
                    key={example.title}
                    type="button"
                    onClick={() => fillMarketExample(example)}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                  >
                    {example.title}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Title</span>
                  <input value={marketTitle} onChange={(e) => setMarketTitle(e.target.value)} className="rounded border border-gray-300 px-3 py-2" required />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Source Name</span>
                  <input value={marketSourceName} onChange={(e) => setMarketSourceName(e.target.value)} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700 sm:col-span-2">
                  <span>Summary</span>
                  <textarea value={marketSummary} onChange={(e) => setMarketSummary(e.target.value)} rows={3} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Source URL</span>
                  <input value={marketSourceUrl} onChange={(e) => setMarketSourceUrl(e.target.value)} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Market Category</span>
                  <select value={marketCategory} onChange={(e) => setMarketCategory(e.target.value)} className="rounded border border-gray-300 px-3 py-2" required>
                    <option value="">Select category</option>
                    {marketCategoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Related Product Category</span>
                  <select value={marketRelatedProductCategory} onChange={(e) => setMarketRelatedProductCategory(e.target.value)} className="rounded border border-gray-300 px-3 py-2">
                    <option value="">None</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Related Product</span>
                  <select value={marketRelatedProductId} onChange={(e) => setMarketRelatedProductId(e.target.value)} className="rounded border border-gray-300 px-3 py-2">
                    <option value="">None</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Impact Direction</span>
                  <select value={marketImpactDirection} onChange={(e) => setMarketImpactDirection(e.target.value)} className="rounded border border-gray-300 px-3 py-2" required>
                    <option value="">Select direction</option>
                    {marketImpactDirectionOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Impact Level</span>
                  <select value={marketImpactLevel} onChange={(e) => setMarketImpactLevel(e.target.value)} className="rounded border border-gray-300 px-3 py-2" required>
                    <option value="">Select level</option>
                    {marketImpactLevelOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Confidence Level</span>
                  <select value={marketConfidenceLevel} onChange={(e) => setMarketConfidenceLevel(e.target.value)} className="rounded border border-gray-300 px-3 py-2" required>
                    <option value="">Select confidence</option>
                    {marketConfidenceOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Affected Area</span>
                  <select value={marketAffectedArea} onChange={(e) => setMarketAffectedArea(e.target.value)} className="rounded border border-gray-300 px-3 py-2" required>
                    <option value="">Select area</option>
                    {marketAffectedAreaOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>News Date</span>
                  <input type="date" value={marketNewsDate} onChange={(e) => setMarketNewsDate(e.target.value)} className="rounded border border-gray-300 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Status</span>
                  <select value={marketStatus} onChange={(e) => setMarketStatus(e.target.value)} className="rounded border border-gray-300 px-3 py-2">
                    {marketIntelligenceStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-gray-700 sm:col-span-2">
                  <span>Suggested Action</span>
                  <textarea value={marketSuggestedAction} onChange={(e) => setMarketSuggestedAction(e.target.value)} rows={2} className="rounded border border-gray-300 px-3 py-2" />
                </label>
              </div>
              <button type="submit" className="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">
                Save Intelligence Item
              </button>
            </form>

            <div className="space-y-5">
              <form onSubmit={createMarketNewsSource} className="rounded border border-gray-200 bg-white p-4">
                <h3 className="text-lg font-medium text-gray-900">Add News Source</h3>
                <div className="mt-4 space-y-3">
                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    <span>Source Name</span>
                    <input value={marketNewsSourceName} onChange={(e) => setMarketNewsSourceName(e.target.value)} className="rounded border border-gray-300 px-3 py-2" required />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    <span>Source Type</span>
                    <input value={marketNewsSourceType} onChange={(e) => setMarketNewsSourceType(e.target.value)} placeholder="newspaper, government, market, supplier" className="rounded border border-gray-300 px-3 py-2" required />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    <span>Source URL</span>
                    <input value={marketNewsSourceUrl} onChange={(e) => setMarketNewsSourceUrl(e.target.value)} className="rounded border border-gray-300 px-3 py-2" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    <span>Country</span>
                    <input value={marketNewsSourceCountry} onChange={(e) => setMarketNewsSourceCountry(e.target.value)} className="rounded border border-gray-300 px-3 py-2" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={marketNewsSourceIsActive} onChange={(e) => setMarketNewsSourceIsActive(e.target.checked)} />
                    Active
                  </label>
                </div>
                <button type="submit" className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800">
                  Save News Source
                </button>
              </form>

              <div className="rounded border border-gray-200 bg-white p-4">
                <h3 className="text-lg font-medium text-gray-900">News Sources</h3>
                <div className="mt-3 space-y-2">
                  {marketNewsSources.length === 0 ? (
                    <p className="text-sm text-gray-600">No manual news sources added yet.</p>
                  ) : (
                    marketNewsSources.map((source) => (
                      <div key={source.id} className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                        <div className="font-medium text-gray-900">{source.source_name}</div>
                        <div className="text-gray-600">{source.source_type} · {source.country ?? "Pakistan"} · {source.is_active ? "Active" : "Inactive"}</div>
                        {source.source_url && <div className="break-all text-xs text-blue-700">{source.source_url}</div>}
                        <button
                          type="button"
                          onClick={() => deleteMarketNewsSource(source)}
                          className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          Delete Source
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Intelligence Feed</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Showing {filteredMarketIntelligenceItems.length} of {marketIntelligenceItems.length} manual signals.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <input
                  type="search"
                  value={marketIntelligenceSearch}
                  onChange={(e) => setMarketIntelligenceSearch(e.target.value)}
                  placeholder="Search title, summary, source"
                  className="rounded border border-gray-300 px-3 py-2 text-sm"
                />
                <select value={marketIntelligenceCategoryFilter} onChange={(e) => setMarketIntelligenceCategoryFilter(e.target.value)} className="rounded border border-gray-300 px-3 py-2 text-sm">
                  <option value="all">All categories</option>
                  {marketCategoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select value={marketIntelligenceImpactFilter} onChange={(e) => setMarketIntelligenceImpactFilter(e.target.value)} className="rounded border border-gray-300 px-3 py-2 text-sm">
                  <option value="all">All impacts</option>
                  {marketImpactDirectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select value={marketIntelligenceStatusFilter} onChange={(e) => setMarketIntelligenceStatusFilter(e.target.value)} className="rounded border border-gray-300 px-3 py-2 text-sm">
                  <option value="all">All statuses</option>
                  {marketIntelligenceStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {filteredMarketIntelligenceItems.length === 0 ? (
                <p className="rounded border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  No market intelligence items match the current filters.
                </p>
              ) : (
                filteredMarketIntelligenceItems.map((item) => {
                  const relatedProduct = products.find((product) => String(product.id) === String(item.related_product_id));
                  return (
                    <div key={item.id} className="rounded border border-gray-200 bg-gray-50 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white">
                              {getMarketLabel(marketCategoryOptions, item.market_category)}
                            </span>
                            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                              {getMarketLabel(marketImpactDirectionOptions, item.impact_direction)}
                            </span>
                            <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                              {getMarketLabel(marketImpactLevelOptions, item.impact_level)}
                            </span>
                            <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-700">
                              {getMarketLabel(marketIntelligenceStatusOptions, item.status)}
                            </span>
                          </div>
                          <h4 className="mt-2 text-base font-semibold text-gray-900">{item.title}</h4>
                          {item.summary && <p className="mt-1 text-sm text-gray-700">{item.summary}</p>}
                          <div className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                            <div>Source: {item.source_name || "Manual note"}</div>
                            <div>Confidence: {getMarketLabel(marketConfidenceOptions, item.confidence_level)}</div>
                            <div>Affected area: {getMarketLabel(marketAffectedAreaOptions, item.affected_area)}</div>
                            <div>Related product: {relatedProduct?.name ?? item.related_product_category ?? "-"}</div>
                            <div>News date: {formatDate(item.news_date)}</div>
                            <div>Created: {formatDateTime(item.created_at)}</div>
                          </div>
                          {item.source_url && <div className="mt-1 break-all text-xs text-blue-700">{item.source_url}</div>}
                          {item.suggested_action && (
                            <div className="mt-3 rounded border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-900">
                              Suggested action: {item.suggested_action}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => analyzeMarketIntelligenceItem(item)}
                            disabled={marketAiAnalysisLoadingId === `item-${item.id}`}
                            className="rounded border border-purple-500 bg-white px-3 py-2 text-xs text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            {marketAiAnalysisLoadingId === `item-${item.id}` ? "Analyzing..." : "Analyze with AI"}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMarketIntelligenceStatus(item, "watching")}
                            disabled={item.status === "watching"}
                            className="rounded border border-amber-500 bg-white px-3 py-2 text-xs text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            Mark Watching
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMarketIntelligenceStatus(item, "archived")}
                            disabled={item.status === "archived"}
                            className="rounded border border-gray-500 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            Archive
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMarketIntelligenceStatus(item, "active")}
                            disabled={item.status === "active"}
                            className="rounded border border-emerald-500 bg-white px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            Reactivate
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMarketIntelligenceItem(item)}
                            className="rounded border border-red-500 bg-white px-3 py-2 text-xs text-red-700 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "ai-assistant" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-medium text-gray-900">AI Action Assistant</h2>
              <p className="mt-1 text-sm text-gray-600">
                This is a safe action-draft assistant. It prepares actions for owner review before saving.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchAiActionDrafts(currentOrganizationId)}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Refresh Drafts
            </button>
          </div>

          <div className="mb-5 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            No external AI API is connected in this phase. Commands are parsed locally into safe review drafts.
            Staff access to AI Assistant can be enabled later by owner.
          </div>

          {aiAssistantMessage && (
            <p className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {aiAssistantMessage}
            </p>
          )}
          {aiAssistantError && (
            <p className="mb-4 whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {aiAssistantError}
            </p>
          )}

          <div className="rounded border border-gray-200 bg-white p-4">
            <label className="block text-sm font-medium text-gray-700" htmlFor="ai-command-text">
              Business Command
            </label>
            <textarea
              id="ai-command-text"
              value={aiCommandText}
              onChange={(e) => setAiCommandText(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="Type a command like: Add task: Call supplier tomorrow about Pepsi rates."
            />
            <div className="mt-3 rounded border border-sky-200 bg-sky-50 p-3">
              <div className="flex flex-wrap gap-2">
                {!isVoiceListening ? (
                  <button
                    type="button"
                    onClick={startVoiceInput}
                    className="rounded bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700"
                  >
                    Start Voice Input
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopVoiceInput}
                    className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                  >
                    Stop Listening
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearVoiceCommand}
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Clear Command
                </button>
              </div>
              {typeof window !== "undefined" && !getSpeechRecognitionConstructor() && (
                <p className="mt-3 text-sm text-amber-800">
                  Browser speech recognition is not available here. You can still type commands manually.
                </p>
              )}
              {voiceInputMessage && <p className="mt-3 text-sm text-sky-900">{voiceInputMessage}</p>}
              {voiceInputError && <p className="mt-3 text-sm text-red-700">{voiceInputError}</p>}
              {voiceTranscriptPreview && (
                <div className="mt-3 rounded border border-sky-200 bg-white px-3 py-2 text-sm text-sky-950">
                  <span className="font-medium">Transcript preview:</span> {voiceTranscriptPreview}
                </div>
              )}
              <p className="mt-3 text-xs text-sky-900">
                Voice input converts speech to text only. You must still review and confirm before TradeOS saves any record.
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {aiAssistantExampleCommands.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setAiCommandText(example)}
                  className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-800 hover:bg-blue-100"
                >
                  {example}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={createAiActionDraft}
              className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Create Draft Action
            </button>
          </div>

          <div className="mt-5 rounded border border-indigo-200 bg-white p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Conversation Panel</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Continue a draft one question at a time. Voice answers become text first and never execute automatically.
                </p>
              </div>
              {selectedConversationDraft && (
                <span className="rounded bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-800">
                  {selectedConversationDraft.action_type}
                </span>
              )}
            </div>

            {!selectedConversationDraft ? (
              <p className="mt-4 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Select Continue Conversation on a draft to start.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Draft summary</div>
                  <p className="mt-1 text-sm font-medium text-gray-900">{selectedConversationDraft.command_text}</p>
                  <p className="mt-1 text-sm text-gray-700">{selectedConversationDraft.confirmation_summary}</p>
                  {selectedConversationMissingFields.length > 0 && (
                    <p className="mt-2 text-xs text-amber-800">
                      Missing: {selectedConversationMissingFields.join(", ")}
                    </p>
                  )}
                </div>

                {aiConversationMessage && (
                  <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                    {aiConversationMessage}
                  </p>
                )}
                {aiConversationError && (
                  <p className="whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {aiConversationError}
                  </p>
                )}

                <div className="max-h-80 space-y-2 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-3">
                  {aiConversationMessages.length === 0 ? (
                    <p className="text-sm text-gray-600">No conversation messages yet.</p>
                  ) : (
                    aiConversationMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded px-3 py-2 text-sm ${
                          message.role === "owner"
                            ? "ml-auto bg-blue-600 text-white"
                            : message.role === "assistant"
                              ? "mr-auto bg-white text-gray-900"
                              : "mx-auto bg-gray-200 text-gray-700"
                        } max-w-[92%]`}
                      >
                        <div className="text-[11px] opacity-75">
                          {message.role} · {message.message_type}
                          {message.related_field ? ` · ${message.related_field}` : ""}
                        </div>
                        <div className="mt-1">{message.message_text}</div>
                      </div>
                    ))
                  )}
                </div>

                {selectedConversationReady && (
                  <div className="rounded border border-green-200 bg-green-50 p-3">
                    <div className="text-sm font-medium text-green-950">Final Confirmation</div>
                    <p className="mt-1 text-sm text-green-900">{selectedConversationEvaluation?.confirmationSummary}</p>
                    {selectedConversationEvaluation?.executionPreview && (
                      <div className="mt-2 grid gap-2 text-xs text-green-900 sm:grid-cols-2">
                        {Object.entries(selectedConversationEvaluation.executionPreview).map(([key, value]) => {
                          if (value === null || value === undefined || value === "") return null;
                          const displayValue =
                            key.includes("price") || key.includes("total") || key === "amount"
                              ? formatPKR(value)
                              : String(value);
                          return (
                            <div key={key} className="rounded border border-green-200 bg-white px-2 py-1">
                              <span className="font-medium">{key.replace(/_/g, " ")}:</span> {displayValue}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => executeAiActionDraft(selectedConversationDraft)}
                        disabled={selectedConversationDraft.status === "executed" || selectedConversationDraft.status === "cancelled"}
                        className="rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        Execute Now
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAiDraftStatus(selectedConversationDraft, "cancelled")}
                        disabled={selectedConversationDraft.status === "executed" || selectedConversationDraft.status === "cancelled"}
                        className="rounded border border-red-500 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                      >
                        Cancel Draft
                      </button>
                    </div>
                  </div>
                )}

                <div className="rounded border border-indigo-200 bg-indigo-50 p-3">
                  <label className="block text-sm font-medium text-indigo-950" htmlFor="ai-conversation-answer">
                    Owner Answer
                  </label>
                  <textarea
                    id="ai-conversation-answer"
                    value={aiConversationInput}
                    onChange={(e) => setAiConversationInput(e.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded border border-indigo-200 px-3 py-2 text-sm"
                    placeholder={
                      selectedConversationReady
                        ? "Type yes, confirm, proceed, or no/cancel."
                        : activeMissingField
                          ? aiConversationQuestionText[activeMissingField] ?? "Answer the current question"
                          : "Answer the assistant question"
                    }
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!isVoiceAnswerListening ? (
                      <button
                        type="button"
                        onClick={startVoiceAnswerInput}
                        className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
                      >
                        Start Voice Answer
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopVoiceAnswerInput}
                        className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                      >
                        Stop Listening
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearVoiceAnswerInput}
                      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Clear Answer
                    </button>
                    <button
                      type="button"
                      onClick={sendAiConversationAnswer}
                      className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                    >
                      Send Answer
                    </button>
                  </div>
                  {voiceAnswerMessage && <p className="mt-2 text-sm text-indigo-900">{voiceAnswerMessage}</p>}
                  {voiceAnswerError && <p className="mt-2 text-sm text-red-700">{voiceAnswerError}</p>}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Recent Drafts</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Showing {filteredAiActionDrafts.length} of {aiActionDrafts.length} draft actions.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[560px]">
                <label className="flex flex-col gap-1 text-xs text-gray-700">
                  <span>Status</span>
                  <select
                    value={aiDraftStatusFilter}
                    onChange={(e) => setAiDraftStatusFilter(e.target.value)}
                    className="rounded border border-gray-300 px-2 py-2"
                  >
                    <option value="all">All</option>
                    <option value="draft">Draft</option>
                    <option value="ready">Ready</option>
                    <option value="needs_info">Needs Info</option>
                    <option value="executed">Executed</option>
                    <option value="failed">Failed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-700">
                  <span>Action type</span>
                  <select
                    value={aiDraftActionTypeFilter}
                    onChange={(e) => setAiDraftActionTypeFilter(e.target.value)}
                    className="rounded border border-gray-300 px-2 py-2"
                  >
                    <option value="all">All action types</option>
                    <option value="task">Task</option>
                    <option value="purchase">Purchase</option>
                    <option value="sale">Sale</option>
                    <option value="expense">Expense</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-700">
                  <span>Search</span>
                  <input
                    type="search"
                    value={aiDraftSearch}
                    onChange={(e) => setAiDraftSearch(e.target.value)}
                    placeholder="Search drafts"
                    className="rounded border border-gray-300 px-2 py-2"
                  />
                </label>
              </div>
            </div>
            {aiActionDrafts.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">No AI action drafts yet.</p>
            ) : filteredAiActionDrafts.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">No drafts match the selected filters.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {filteredAiActionDrafts.map((draft) => {
                  const draftEvaluation = evaluateAiDraftData(draft.action_type, draft.parsed_data ?? {});
                  const missingFields =
                    getAiDraftMissingFields(draft).length > 0
                      ? getAiDraftMissingFields(draft)
                      : draftEvaluation.missingFields;
                  const followUpQuestions =
                    draft.follow_up_questions && draft.follow_up_questions.length > 0
                      ? draft.follow_up_questions
                      : draftEvaluation.followUpQuestions;
                  const expenseOptionalQuestions =
                    draft.action_type === "create_expense_draft"
                      ? [
                          { field: "notes", question: "Notes", input_type: "text" },
                          { field: "supplier_id", question: "Related supplier", input_type: "select" },
                          { field: "customer_id", question: "Related customer", input_type: "select" },
                          { field: "purchase_transaction_id", question: "Related purchase invoice", input_type: "select" },
                          { field: "sales_transaction_id", question: "Related sales invoice", input_type: "select" },
                        ]
                      : [];
                  const displayedFollowUpQuestions = [
                    ...followUpQuestions,
                    ...expenseOptionalQuestions.filter(
                      (optionalQuestion) =>
                        !followUpQuestions.some((question) => question.field === optionalQuestion.field)
                    ),
                  ];
                  const executionPreview = draft.execution_preview ?? draftEvaluation.executionPreview;
                  const readyToExecute = Boolean(draft.ready_to_execute || draftEvaluation.readyToExecute);
                  const relatedCustomer = customers.find((customer) => customer.id === draft.related_customer_id);
                  const relatedSupplier = suppliers.find((supplier) => supplier.id === draft.related_supplier_id);
                  const relatedProduct = products.find((product) => String(product.id) === String(draft.related_product_id));
                  const executedTask = tasks.find((task) => String(task.id) === String(draft.executed_entity_id));
                  const executedPurchase = purchaseTransactions.find((tx) => String(tx.id) === String(draft.executed_entity_id));
                  const executedSale = salesTransactions.find((tx) => String(tx.id) === String(draft.executed_entity_id));
                  const executedExpense = expenses.find((expense) => String(expense.id) === String(draft.executed_entity_id));
                  const isSelectedDraft = selectedAiDraftId === draft.id;
                  const executeLabel =
                    draft.action_type === "create_purchase_draft"
                      ? "Execute Purchase"
                      : draft.action_type === "create_sale_draft"
                        ? "Execute Sale"
                        : draft.action_type === "create_task"
                          ? "Execute Task"
                          : draft.action_type === "create_expense_draft"
                            ? "Execute Expense"
                            : "Execute Draft";
                  const executionRecordName =
                    draft.action_type === "create_purchase_draft"
                      ? "purchase"
                      : draft.action_type === "create_sale_draft"
                        ? "sale"
                        : draft.action_type === "create_expense_draft"
                          ? "expense"
                          : draft.action_type === "create_task"
                            ? "task"
                            : "record";
                  return (
                    <div
                      key={draft.id}
                      className={`rounded border p-4 ${isSelectedDraft ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-gray-50"}`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white">
                              {draft.action_type}
                            </span>
                            <span className={`rounded px-2 py-1 text-xs font-medium ${
                              draft.status === "executed"
                                ? "bg-green-100 text-green-800"
                                : draft.status === "cancelled" || draft.status === "failed"
                                  ? "bg-red-100 text-red-800"
                                  : draft.status === "needs_info"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-blue-100 text-blue-800"
                            }`}>
                              {draft.status}
                            </span>
                            <span className={`rounded px-2 py-1 text-xs font-medium ${
                              readyToExecute ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                            }`}>
                              {readyToExecute ? "Ready to execute" : "Not ready"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-gray-900">{draft.command_text}</p>
                          <p className="mt-1 text-sm text-gray-700">{draft.confirmation_summary}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                            <span>Created: {formatDateTime(draft.created_at)}</span>
                            {relatedCustomer && <span>Customer: {relatedCustomer.customer_name}</span>}
                            {relatedSupplier && <span>Supplier: {relatedSupplier.supplier_name}</span>}
                            {relatedProduct && <span>Product: {relatedProduct.name}</span>}
                          </div>
                          {missingFields.length > 0 && (
                            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                              Missing fields: {missingFields.join(", ")}
                            </div>
                          )}
                          {executionPreview && (
                            <div className="mt-3 rounded border border-gray-200 bg-white p-3">
                              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Execution Preview</div>
                              <div className="mt-2 grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                                {Object.entries(executionPreview).map(([key, value]) => {
                                  if (value === null || value === undefined || value === "") return null;
                                  const displayValue =
                                    key.includes("price") ||
                                    key.includes("total") ||
                                    key === "amount"
                                      ? formatPKR(value)
                                      : String(value);
                                  return (
                                    <div key={key} className="rounded border border-gray-100 bg-gray-50 px-2 py-1">
                                      <span className="font-medium">{key.replace(/_/g, " ")}:</span> {displayValue}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {displayedFollowUpQuestions.length > 0 && draft.status !== "executed" && draft.status !== "cancelled" && (
                            <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3">
                              <div className="text-sm font-medium text-blue-950">Manual draft fields</div>
                              <p className="mt-1 text-xs text-blue-900">
                                Backup form for directly editing draft fields if conversation is not enough.
                              </p>
                              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {displayedFollowUpQuestions.map((question) => {
                                  const currentAnswer =
                                    aiDraftAnswerInputs[draft.id]?.[question.field] ??
                                    String((draft.follow_up_answers ?? {})[question.field] ?? (draft.parsed_data ?? {})[question.field] ?? "");
                                  const updateAnswer = (value: string) =>
                                    setAiDraftAnswerInputs((current) => ({
                                      ...current,
                                      [draft.id]: {
                                        ...(current[draft.id] ?? {}),
                                        [question.field]: value,
                                      },
                                    }));

                                  if (question.field === "supplier_id") {
                                    return (
                                      <label key={question.field} className="flex flex-col gap-1 text-xs text-blue-950">
                                        <span>{question.question}</span>
                                        <select value={currentAnswer} onChange={(e) => updateAnswer(e.target.value)} className="rounded border border-blue-200 px-2 py-2">
                                          <option value="">Select supplier</option>
                                          {suppliers.map((supplier) => (
                                            <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>
                                          ))}
                                        </select>
                                      </label>
                                    );
                                  }
                                  if (question.field === "customer_id") {
                                    return (
                                      <label key={question.field} className="flex flex-col gap-1 text-xs text-blue-950">
                                        <span>{question.question}</span>
                                        <select value={currentAnswer} onChange={(e) => updateAnswer(e.target.value)} className="rounded border border-blue-200 px-2 py-2">
                                          <option value="">Select customer</option>
                                          {customers.map((customer) => (
                                            <option key={customer.id} value={customer.id}>{customer.customer_name}</option>
                                          ))}
                                        </select>
                                      </label>
                                    );
                                  }
                                  if (question.field === "product_id") {
                                    return (
                                      <label key={question.field} className="flex flex-col gap-1 text-xs text-blue-950">
                                        <span>{question.question}</span>
                                        <select value={currentAnswer} onChange={(e) => updateAnswer(e.target.value)} className="rounded border border-blue-200 px-2 py-2">
                                          <option value="">Select product</option>
                                          {products.map((product) => (
                                            <option key={product.id} value={product.id}>{product.name}</option>
                                          ))}
                                        </select>
                                      </label>
                                    );
                                  }
                                  if (question.field === "payment_type") {
                                    return (
                                      <label key={question.field} className="flex flex-col gap-1 text-xs text-blue-950">
                                        <span>{question.question}</span>
                                        <select value={currentAnswer} onChange={(e) => updateAnswer(e.target.value)} className="rounded border border-blue-200 px-2 py-2">
                                          <option value="">Select payment type</option>
                                          <option value="cash">Cash</option>
                                          <option value="credit">Credit</option>
                                        </select>
                                      </label>
                                    );
                                  }
                                  if (question.field === "expense_type") {
                                    return (
                                      <label key={question.field} className="flex flex-col gap-1 text-xs text-blue-950">
                                        <span>{question.question}</span>
                                        <select value={currentAnswer} onChange={(e) => updateAnswer(e.target.value)} className="rounded border border-blue-200 px-2 py-2">
                                          <option value="">Select expense type</option>
                                          {expenseTypes.map((type) => (
                                            <option key={type} value={type}>{type}</option>
                                          ))}
                                        </select>
                                      </label>
                                    );
                                  }
                                  if (question.field === "purchase_transaction_id") {
                                    return (
                                      <label key={question.field} className="flex flex-col gap-1 text-xs text-blue-950">
                                        <span>{question.question}</span>
                                        <select value={currentAnswer} onChange={(e) => updateAnswer(e.target.value)} className="rounded border border-blue-200 px-2 py-2">
                                          <option value="">Select purchase invoice</option>
                                          {purchaseTransactions.map((transaction) => (
                                            <option key={transaction.id} value={transaction.id}>
                                              {transaction.invoice_number} - {formatDate(transaction.purchase_date)}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    );
                                  }
                                  if (question.field === "sales_transaction_id") {
                                    return (
                                      <label key={question.field} className="flex flex-col gap-1 text-xs text-blue-950">
                                        <span>{question.question}</span>
                                        <select value={currentAnswer} onChange={(e) => updateAnswer(e.target.value)} className="rounded border border-blue-200 px-2 py-2">
                                          <option value="">Select sales invoice</option>
                                          {salesTransactions.map((transaction) => (
                                            <option key={transaction.id} value={transaction.id}>
                                              {transaction.invoice_number} - {formatDate(transaction.sale_date)}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    );
                                  }
                                  return (
                                    <label key={question.field} className="flex flex-col gap-1 text-xs text-blue-950">
                                      <span>{question.question}</span>
                                      <input
                                        type={question.input_type === "number" ? "number" : "text"}
                                        min={question.input_type === "number" ? "0" : undefined}
                                        step={question.input_type === "number" ? "0.01" : undefined}
                                        value={currentAnswer}
                                        onChange={(e) => updateAnswer(e.target.value)}
                                        className="rounded border border-blue-200 px-2 py-2"
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedAiDraftId(draft.id);
                                  saveAiDraftAnswers(draft);
                                }}
                                className="mt-3 rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700"
                              >
                                Save Answers
                              </button>
                            </div>
                          )}
                          {readyToExecute && draft.status !== "executed" && draft.status !== "cancelled" && (
                            <div className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
                              You are about to create a real {executionRecordName} record. Please confirm details before executing.
                            </div>
                          )}
                          {draft.status === "executed" && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
                              {draft.executed_entity_type === "task" && (
                                <>
                                  <span>Created Task{executedTask?.title ? `: ${executedTask.title}` : ""}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleSectionChange("task-manager")}
                                    className="rounded border border-green-300 bg-white px-2 py-1 text-green-800 hover:bg-green-100"
                                  >
                                    Open Tasks
                                  </button>
                                </>
                              )}
                              {draft.executed_entity_type === "purchase_invoice" && (
                                <>
                                  <span>Created Purchase{executedPurchase?.invoice_number ? `: ${executedPurchase.invoice_number}` : ""}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleSectionChange("purchases")}
                                    className="rounded border border-green-300 bg-white px-2 py-1 text-green-800 hover:bg-green-100"
                                  >
                                    Open Purchases
                                  </button>
                                </>
                              )}
                              {draft.executed_entity_type === "sales_invoice" && (
                                <>
                                  <span>Created Sale{executedSale?.invoice_number ? `: ${executedSale.invoice_number}` : ""}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleSectionChange("sales")}
                                    className="rounded border border-green-300 bg-white px-2 py-1 text-green-800 hover:bg-green-100"
                                  >
                                    Open Sales
                                  </button>
                                </>
                              )}
                              {draft.executed_entity_type === "expense" && (
                                <>
                                  <span>Created Expense{executedExpense?.expense_type ? `: ${executedExpense.expense_type}` : ""}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleSectionChange("expenses")}
                                    className="rounded border border-green-300 bg-white px-2 py-1 text-green-800 hover:bg-green-100"
                                  >
                                    Open Expenses
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {draft.error_message && (
                            <div className="mt-2 whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                              {draft.error_message}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => continueAiConversation(draft)}
                            className="rounded border border-indigo-500 bg-white px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-50"
                          >
                            Continue Conversation
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAiDraftId(draft.id);
                              updateAiDraftStatus(draft, "needs_info");
                            }}
                            disabled={draft.status === "executed" || draft.status === "cancelled"}
                            className="rounded border border-amber-500 bg-white px-3 py-2 text-xs text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            Mark Needs Info
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAiDraftId(draft.id);
                              updateAiDraftStatus(draft, "cancelled");
                            }}
                            disabled={draft.status === "executed" || draft.status === "cancelled"}
                            className="rounded border border-red-500 bg-white px-3 py-2 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                          >
                            Cancel Draft
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAiDraftId(draft.id);
                              executeAiActionDraft(draft);
                            }}
                            disabled={
                              draft.status === "executed" ||
                              draft.status === "cancelled" ||
                              draft.status === "failed" ||
                              !readyToExecute ||
                              missingFields.length > 0
                            }
                            className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            {executeLabel}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-5 rounded border border-purple-200 bg-purple-50 p-4">
            <h3 className="text-lg font-medium text-purple-950">Future AI Assistant Roadmap</h3>
            <p className="mt-1 text-sm text-purple-900">
              These capabilities are planned for later and are not active in this foundation phase.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {aiAssistantRoadmapItems.map((item) => (
                <div key={item} className="rounded border border-purple-200 bg-white px-3 py-2 text-sm text-purple-900">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "staff-duty" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-medium text-gray-900">Staff Duty</h2>
              <p className="mt-1 text-sm text-gray-600">
                Start duty, save browser location points, and monitor staff location while TradeOS is open.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                fetchDutySessions(currentOrganizationId, currentProfile?.id);
                fetchLocationPoints(currentOrganizationId);
              }}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Refresh Duty Data
            </button>
          </div>

          <div className="mb-5 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Location tracking works while the app is open/active. True background tracking may require a native mobile app later.
          </div>

          {locationTrackingMessage && (
            <p className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {locationTrackingMessage}
            </p>
          )}
          {locationTrackingError && (
            <p className="mb-4 whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {locationTrackingError}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Current Duty Status</div>
              <div className={`mt-2 text-2xl font-semibold ${activeDutySession ? "text-green-700" : "text-gray-900"}`}>
                {activeDutySession ? "On Duty" : "Off Duty"}
              </div>
              <p className="mt-2 text-sm text-gray-600">
                {isTrackingLocation ? "Live tracking is active." : "Live tracking is not active."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleStartDuty}
                  disabled={Boolean(activeDutySession)}
                  className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Start Duty
                </button>
                <button
                  type="button"
                  onClick={handleEndDuty}
                  disabled={!activeDutySession}
                  className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  End Duty
                </button>
              </div>
            </div>

            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Last Location Update</div>
              <div className="mt-2 text-lg font-semibold text-gray-900">
                {latestOwnLocation ? formatDateTime(latestOwnLocation.captured_at) : "No location yet"}
              </div>
              <div className="mt-3 space-y-1 text-sm text-gray-700">
                <div>Latitude: {latestOwnLocation ? formatCoordinate(latestOwnLocation.latitude) : "-"}</div>
                <div>Longitude: {latestOwnLocation ? formatCoordinate(latestOwnLocation.longitude) : "-"}</div>
                <div>Accuracy: {latestOwnLocation?.accuracy ? `${Math.round(latestOwnLocation.accuracy)} m` : "-"}</div>
              </div>
            </div>

            <div className="rounded border border-blue-200 bg-blue-50 p-4">
              <div className="text-sm font-medium text-blue-950">Browser Permission</div>
              <p className="mt-2 text-sm text-blue-900">
                Your browser will ask for location permission when duty starts. Allow location access and keep TradeOS open for live updates.
              </p>
            </div>
          </div>

          {isOwnerOrAdmin() && (
            <div className="mt-6 rounded border border-gray-200 bg-white p-4">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Owner Staff Location Monitor</h3>
                  <p className="mt-1 text-sm text-gray-600">Monitor staff duty sessions and recent location history.</p>
                </div>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span>Select Staff</span>
                  <select
                    value={selectedStaffForLocation}
                    onChange={(e) => setSelectedStaffForLocation(e.target.value)}
                    className="rounded border border-gray-300 px-3 py-2"
                  >
                    <option value="">Current user</option>
                    {staffProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.display_name || profile.email || profile.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">On-duty staff</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">{ownerOnDutyCount}</div>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Off-duty/recent sessions</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">{ownerRecentOffDutyCount}</div>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Last organization update</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">
                    {visibleLocationPoints[0] ? formatDateTime(visibleLocationPoints[0].captured_at) : "No points yet"}
                  </div>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Staff</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Latest Location</th>
                      <th className="px-3 py-2">Last Update</th>
                      <th className="px-3 py-2">Accuracy</th>
                      <th className="px-3 py-2">Latest Session Start</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {staffProfiles.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-gray-600">No staff profiles loaded.</td>
                      </tr>
                    ) : (
                      staffProfiles.map((profile) => {
                        const latestPoint = latestLocationByProfile[profile.id];
                        const latestSession = dutySessions.find((session) => session.profile_id === profile.id);
                        const isOnDuty = onDutyProfileIds.has(profile.id);
                        return (
                          <tr key={profile.id}>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => setSelectedStaffForLocation(profile.id)}
                                className="text-left font-medium text-blue-700 hover:underline"
                              >
                                {profile.display_name || profile.email || profile.id}
                              </button>
                              <div className="text-xs text-gray-500">{profile.email ?? "No email"}</div>
                            </td>
                            <td className="px-3 py-3">{profile.role ?? "owner"}</td>
                            <td className="px-3 py-3">
                              <span className={`rounded px-2 py-1 text-xs font-medium ${
                                isOnDuty ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                              }`}>
                                {isOnDuty ? "On Duty" : "Off Duty"}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              {latestPoint ? `${formatCoordinate(latestPoint.latitude)}, ${formatCoordinate(latestPoint.longitude)}` : "-"}
                            </td>
                            <td className="px-3 py-3">{latestPoint ? formatDateTime(latestPoint.captured_at) : "-"}</td>
                            <td className="px-3 py-3">{latestPoint?.accuracy ? `${Math.round(latestPoint.accuracy)} m` : "-"}</td>
                            <td className="px-3 py-3">{latestSession ? formatDateTime(latestSession.started_at) : "-"}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 rounded border border-gray-200 bg-gray-50 p-4">
                <h4 className="text-base font-medium text-gray-900">
                  Recent Location History{selectedLocationProfile ? `: ${selectedLocationProfile.display_name || selectedLocationProfile.email || selectedLocationProfile.id}` : ""}
                </h4>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-white text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Captured At</th>
                        <th className="px-3 py-2">Latitude</th>
                        <th className="px-3 py-2">Longitude</th>
                        <th className="px-3 py-2">Accuracy</th>
                        <th className="px-3 py-2">Speed</th>
                        <th className="px-3 py-2">Map</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {selectedStaffLocationPoints.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-gray-600">No recent location points for this staff member.</td>
                        </tr>
                      ) : (
                        selectedStaffLocationPoints.slice(0, 50).map((point) => (
                          <tr key={point.id}>
                            <td className="px-3 py-3">{formatDateTime(point.captured_at)}</td>
                            <td className="px-3 py-3">{formatCoordinate(point.latitude)}</td>
                            <td className="px-3 py-3">{formatCoordinate(point.longitude)}</td>
                            <td className="px-3 py-3">{point.accuracy ? `${Math.round(point.accuracy)} m` : "-"}</td>
                            <td className="px-3 py-3">{point.speed ? `${point.speed.toFixed(1)} m/s` : "-"}</td>
                            <td className="px-3 py-3">
                              <a
                                href={`https://www.google.com/maps?q=${point.latitude},${point.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-700 hover:underline"
                              >
                                Open Map
                              </a>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-5 rounded border border-purple-200 bg-purple-50 p-4">
                <h4 className="text-base font-medium text-purple-950">Possible Stops</h4>
                <p className="mt-1 text-sm text-purple-900">
                  V1 stop detection checks for two consecutive points within roughly 50 meters over 5 minutes or more.
                </p>
                {selectedStaffChronologicalPoints.length < 2 ? (
                  <p className="mt-3 text-sm text-purple-900">Not enough location history to detect stops yet.</p>
                ) : possibleStops.length === 0 ? (
                  <p className="mt-3 text-sm text-purple-900">No possible stops detected from the recent location history.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-purple-200 text-sm">
                      <thead className="bg-white text-left text-xs uppercase tracking-wide text-purple-700">
                        <tr>
                          <th className="px-3 py-2">Start</th>
                          <th className="px-3 py-2">End</th>
                          <th className="px-3 py-2">Duration</th>
                          <th className="px-3 py-2">Approx Location</th>
                          <th className="px-3 py-2">Map</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-purple-200 bg-white">
                        {possibleStops.map((stop) => (
                          <tr key={`${stop.startTime}-${stop.endTime}`}>
                            <td className="px-3 py-3">{formatDateTime(stop.startTime)}</td>
                            <td className="px-3 py-3">{formatDateTime(stop.endTime)}</td>
                            <td className="px-3 py-3">{stop.durationMinutes} min</td>
                            <td className="px-3 py-3">{formatCoordinate(stop.latitude)}, {formatCoordinate(stop.longitude)}</td>
                            <td className="px-3 py-3">
                              <a
                                href={`https://www.google.com/maps?q=${stop.latitude},${stop.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-700 hover:underline"
                              >
                                Open Map
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
        )}

        {activeSectionAllowed && activeSection === "mobile-app" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-medium text-gray-900">Mobile App Readiness</h2>
              <p className="mt-1 text-sm text-gray-600">
                Install TradeOS from a mobile browser and prepare for future mobile workflows.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSectionChange("deployment")}
              className="rounded border border-blue-600 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
            >
              Open Deployment Readiness
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {mobileReadinessItems.map((item) => {
              const ready = item.status === "Ready";
              return (
                <div key={item.label} className="rounded border border-gray-200 bg-white p-4">
                  <div className="text-sm font-medium text-gray-900">{item.label}</div>
                  <span className={`mt-3 inline-flex rounded px-2 py-1 text-xs font-medium ${
                    ready ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"
                  }`}>
                    {item.status}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-lg font-medium text-gray-900">Android Chrome</h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
                <li>Open TradeOS in Chrome.</li>
                <li>Tap three-dot menu.</li>
                <li>Tap Add to Home screen or Install app.</li>
                <li>Open TradeOS from the home screen icon.</li>
              </ol>
            </div>

            <div className="rounded border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-lg font-medium text-gray-900">iPhone Safari</h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
                <li>Open TradeOS in Safari.</li>
                <li>Tap Share.</li>
                <li>Tap Add to Home Screen.</li>
                <li>Open TradeOS from the home screen icon.</li>
              </ol>
            </div>
          </div>

          <div className="mt-5 rounded border border-blue-200 bg-blue-50 p-4">
            <h3 className="text-lg font-medium text-blue-950">Future Mobile Roadmap</h3>
            <p className="mt-1 text-sm text-blue-900">
              These mobile capabilities are planned for later and are not active yet.
            </p>
            <p className="mt-2 text-sm text-blue-900">
              Staff Duty Mode uses browser location permission and works best when TradeOS is installed on the phone home screen.
            </p>
            <p className="mt-2 text-sm text-blue-900">
              AI voice input works best in supported mobile browsers. Full home-screen voice shortcut will be added later.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {mobileRoadmapItems.map((item) => (
                <div key={item} className="rounded border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "deployment" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-5">
            <h2 className="text-xl font-medium text-gray-900">Deployment Readiness</h2>
            <p className="mt-1 text-sm text-gray-600">
              Vercel deployment preparation and environment checks for TradeOS.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">App Build Status</div>
              <div className="mt-2 text-lg font-semibold text-gray-900">Manual build required</div>
              <p className="mt-1 text-xs text-gray-500">Run the local production build before deployment.</p>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Environment Status</div>
              <div className="mt-2 text-lg font-semibold text-gray-900">
                {deploymentWarningCount === 0 ? "Ready locally" : "Needs review"}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {deploymentPassedCount} passing, {deploymentManualCount} manual.
              </p>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Security Status</div>
              <div className="mt-2 text-lg font-semibold text-gray-900">
                {allSecurityChecksPassed ? "Security checks passed" : "Final checks pending"}
              </div>
              <p className="mt-1 text-xs text-gray-500">Use Security Check before launch.</p>
            </div>
            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-500">Business Setup Status</div>
              <div className="mt-2 text-lg font-semibold text-gray-900">
                {businessSettingsComplete ? "Business details ready" : "Business details needed"}
              </div>
              <p className="mt-1 text-xs text-gray-500">Business name plus phone or address recommended.</p>
            </div>
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Environment Checklist</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {deploymentEnvironmentChecks.map((check) => {
                const statusClass =
                  check.status === "pass"
                    ? "bg-green-100 text-green-800"
                    : check.status === "manual"
                      ? "bg-blue-100 text-blue-800"
                      : check.status === "info"
                        ? "bg-gray-100 text-gray-800"
                        : "bg-amber-100 text-amber-800";
                return (
                  <div key={check.key} className="rounded border border-gray-200 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-gray-900">{check.label}</div>
                      <span className={`rounded px-2 py-1 text-xs font-medium ${statusClass}`}>
                        {check.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{check.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Deployment Commands</h3>
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-800">Build locally</h4>
                <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{`taskkill /F /IM node.exe
rmdir /s /q .next
set NODE_OPTIONS=--max-old-space-size=4096
npm.cmd run build`}</pre>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-800">Push latest main</h4>
                <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{`git status
git push origin main`}</pre>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-800">Vercel setup reminder</h4>
                <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{`Add these variables in Vercel:
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY`}</pre>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">Secret values are never displayed here.</p>
          </div>

          <div className="mt-5 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <h3 className="mb-2 text-lg font-medium text-amber-950">Before Public Launch</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>Do not expose service role key.</li>
              <li>Confirm RLS policies are enabled.</li>
              <li>Confirm owner account can login after deployment.</li>
              <li>Test product/customer/supplier/purchase/sale/payment flows on deployed URL.</li>
              <li>Keep database backups before major changes.</li>
            </ul>
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-medium text-gray-900">Deployment Test Checklist</h3>
              <span className="text-sm text-gray-500">
                {deploymentManualCompletedCount} / {deploymentManualChecklistItems.length} complete
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {deploymentManualChecklistItems.map((item) => (
                <label key={item} className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(deploymentChecklistState[item])}
                    onChange={(event) =>
                      setDeploymentChecklistState((current) => ({
                        ...current,
                        [item]: event.target.checked,
                      }))
                    }
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "security-check" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-medium text-gray-900">Security Check</h2>
              <p className="mt-1 text-sm text-gray-600">Final security test mode and production readiness checklist.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={seedSecurityChecklist}
                className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              >
                Seed Security Checklist
              </button>
              <button
                type="button"
                onClick={() => fetchSecurityChecks(currentOrganizationId)}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {securityCheckMessage && <p className="mb-4 text-sm text-green-700">{securityCheckMessage}</p>}
          {securityCheckError && <p className="mb-4 whitespace-pre-wrap text-sm text-red-700">{securityCheckError}</p>}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-gray-200 bg-white p-3">
              <div className="text-sm text-gray-500">Total Checks</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{securityCheckSummary.total}</div>
            </div>
            <div className="rounded border border-green-200 bg-white p-3">
              <div className="text-sm text-green-700">Passed</div>
              <div className="mt-1 text-2xl font-semibold text-green-800">{securityCheckSummary.passed}</div>
            </div>
            <div className="rounded border border-amber-200 bg-white p-3">
              <div className="text-sm text-amber-700">Pending</div>
              <div className="mt-1 text-2xl font-semibold text-amber-800">{securityCheckSummary.pending}</div>
            </div>
            <div className="rounded border border-red-200 bg-white p-3">
              <div className="text-sm text-red-700">Failed</div>
              <div className="mt-1 text-2xl font-semibold text-red-800">{securityCheckSummary.failed}</div>
            </div>
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Production Readiness Checklist</h3>
            <div className="space-y-3">
              {displayedSecurityChecks.map((check) => {
                const statusClass =
                  check.status === "pass"
                    ? "bg-green-100 text-green-800"
                    : check.status === "fail"
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-800";
                return (
                  <div key={check.check_key} className="rounded border border-gray-200 bg-gray-50 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-medium text-gray-900">{check.check_label}</h4>
                          <span className={`rounded px-2 py-1 text-xs font-medium ${statusClass}`}>
                            {check.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Checked at: {check.checked_at ? formatDate(check.checked_at) : "Not checked yet"}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateSecurityCheckStatus(check, "pass")}
                          className="rounded border border-green-600 px-3 py-2 text-xs text-green-700 hover:bg-green-50"
                        >
                          Mark Pass
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSecurityCheckStatus(check, "fail")}
                          className="rounded border border-red-600 px-3 py-2 text-xs text-red-700 hover:bg-red-50"
                        >
                          Mark Fail
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSecurityCheckStatus(check, "pending")}
                          className="rounded border border-gray-400 px-3 py-2 text-xs text-gray-700 hover:bg-gray-100"
                        >
                          Reset Pending
                        </button>
                      </div>
                    </div>
                    <label className="mt-3 flex flex-col gap-2 text-sm text-gray-700">
                      <span>Notes</span>
                      <textarea
                        value={securityCheckNotes[check.check_key] ?? ""}
                        onChange={(e) =>
                          setSecurityCheckNotes((current) => ({
                            ...current,
                            [check.check_key]: e.target.value,
                          }))
                        }
                        rows={2}
                        className="rounded border border-gray-300 px-3 py-2"
                        placeholder="Add notes before marking status"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={`mt-5 rounded border p-4 text-sm ${
            allSecurityChecksPassed
              ? "border-green-200 bg-green-50 text-green-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}>
            {allSecurityChecksPassed
              ? "TradeOS is ready for deployment preparation."
              : "Complete all security checks before deployment."}
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "activity-logs" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-medium text-gray-900">Activity Logs</h2>
              <p className="mt-1 text-sm text-gray-600">Owner activity history for important TradeOS actions.</p>
            </div>
            <button
              type="button"
              onClick={() => fetchAuditLogs(currentOrganizationId)}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Refresh Logs
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-gray-200 bg-white p-3">
              <div className="text-sm text-gray-500">Total Logs</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{auditLogSummary.total}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-3">
              <div className="text-sm text-gray-500">Today's Activity</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{auditLogSummary.today}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-3">
              <div className="text-sm text-gray-500">Creates</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{auditLogSummary.creates}</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-3">
              <div className="text-sm text-gray-500">Updates / Deletes</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{auditLogSummary.updatesDeletes}</div>
            </div>
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Filters</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="flex flex-col gap-2 text-sm text-gray-700 lg:col-span-2">
                <span>Search</span>
                <input
                  type="search"
                  value={auditLogSearch}
                  onChange={(e) => setAuditLogSearch(e.target.value)}
                  placeholder="Search action, entity, label, description, actor"
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Entity Type</span>
                <select
                  value={auditLogEntityFilter}
                  onChange={(e) => setAuditLogEntityFilter(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  <option value="all">All entity types</option>
                  {auditLogEntityTypes.map((entityType) => (
                    <option key={entityType} value={entityType}>{entityType.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Action</span>
                <select
                  value={auditLogActionFilter}
                  onChange={(e) => setAuditLogActionFilter(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  <option value="all">All actions</option>
                  {auditLogActions.map((action) => (
                    <option key={action} value={action}>{action}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Date From</span>
                <input
                  type="date"
                  value={auditLogDateFrom}
                  onChange={(e) => setAuditLogDateFrom(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Date To</span>
                <input
                  type="date"
                  value={auditLogDateTo}
                  onChange={(e) => setAuditLogDateTo(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>
            </div>
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-medium text-gray-900">Log Entries</h3>
              <div className="text-sm text-gray-500">{filteredAuditLogs.length} shown</div>
            </div>

            {filteredAuditLogs.length === 0 ? (
              <p className="text-sm text-gray-600">No activity logs match the current filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Entity Type</th>
                      <th className="px-3 py-2">Entity Label</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Actor</th>
                      <th className="px-3 py-2">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredAuditLogs.map((log) => {
                      const isExpanded = Boolean(expandedAuditLogIds[log.id]);
                      return (
                        <tr key={log.id} className="align-top">
                          <td className="px-3 py-3 whitespace-nowrap">{formatDate(log.created_at)}</td>
                          <td className="px-3 py-3 font-medium capitalize text-gray-900">{log.action}</td>
                          <td className="px-3 py-3">{log.entity_type.replace(/_/g, " ")}</td>
                          <td className="px-3 py-3">{log.entity_label ?? "-"}</td>
                          <td className="px-3 py-3 min-w-[240px]">{log.description ?? "-"}</td>
                          <td className="px-3 py-3">{log.actor_email ?? "-"}</td>
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedAuditLogIds((current) => ({
                                  ...current,
                                  [log.id]: !current[log.id],
                                }))
                              }
                              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              {isExpanded ? "Hide" : "Show"}
                            </button>
                            {isExpanded && (
                              <div className="mt-3 grid min-w-[320px] gap-3 lg:grid-cols-2">
                                <div>
                                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Old Values</div>
                                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-900 p-3 text-xs text-gray-100">
                                    {JSON.stringify(log.old_values ?? null, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">New Values</div>
                                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-900 p-3 text-xs text-gray-100">
                                    {JSON.stringify(log.new_values ?? null, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "task-manager" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Task Manager</h2>

          <div className="rounded border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-lg font-medium text-gray-900">Create Task</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Title</span>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Task Type</span>
                <select
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  {taskTypes.map((type) => (
                    <option key={type} value={type}>{taskTypeLabels[type]}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Priority</span>
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  {taskPriorities.map((priority) => (
                    <option key={priority} value={priority}>{taskPriorityLabels[priority]}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Status</span>
                <select
                  value={taskStatus}
                  onChange={(e) => setTaskStatus(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  {taskStatuses.map((status) => (
                    <option key={status} value={status}>{taskStatusLabels[status]}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Due Date</span>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Related Customer</span>
                <select
                  value={selectedTaskCustomerId}
                  onChange={(e) => setSelectedTaskCustomerId(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  <option value="">No customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.customer_name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Related Supplier</span>
                <select
                  value={selectedTaskSupplierId}
                  onChange={(e) => setSelectedTaskSupplierId(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  <option value="">No supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Related Product</span>
                <select
                  value={selectedTaskProductId}
                  onChange={(e) => setSelectedTaskProductId(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  <option value="">No product</option>
                  {products.map((product) => (
                    <option key={product.id} value={String(product.id)}>{product.name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Related Purchase Invoice</span>
                <select
                  value={selectedTaskPurchaseId}
                  onChange={(e) => setSelectedTaskPurchaseId(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  <option value="">No purchase invoice</option>
                  {purchaseTransactions.map((transaction) => (
                    <option key={transaction.id} value={transaction.id}>{transaction.invoice_number}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Related Sales Invoice</span>
                <select
                  value={selectedTaskSaleId}
                  onChange={(e) => setSelectedTaskSaleId(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                >
                  <option value="">No sales invoice</option>
                  {salesTransactions.map((transaction) => (
                    <option key={transaction.id} value={transaction.id}>{transaction.invoice_number}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-4 flex flex-col gap-2 text-sm text-gray-700">
              <span>Notes</span>
              <textarea
                value={taskNotes}
                onChange={(e) => setTaskNotes(e.target.value)}
                rows={3}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>

            <button
              type="button"
              onClick={saveTask}
              disabled={taskLoading}
              className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {taskLoading ? "Saving..." : "Save Task"}
            </button>
            {taskMessage && <p className="mt-3 text-sm text-green-700">{taskMessage}</p>}
            {taskError && <p className="mt-3 whitespace-pre-wrap text-sm text-red-700">{taskError}</p>}
          </div>

          <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4">
            <h3 className="mb-3 text-lg font-medium text-amber-950">Suggested Tasks</h3>
            {taskSuggestions.length === 0 ? (
              <p className="text-sm text-amber-900">No suggestions right now.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {taskSuggestions.map((suggestion) => (
                  <div key={suggestion.key} className="rounded border border-amber-200 bg-white p-3 text-sm">
                    <div className="font-medium text-gray-900">{suggestion.title}</div>
                    <div className="mt-1 text-gray-600">{suggestion.reason}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>{taskTypeLabels[suggestion.task_type]}</span>
                      <span>{taskPriorityLabels[suggestion.priority]}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => createTaskFromSuggestion(suggestion)}
                      disabled={taskLoading}
                      className="mt-3 rounded border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-400"
                    >
                      Create Task
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 rounded border border-gray-200 bg-white p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h3 className="text-lg font-medium text-gray-900">Tasks</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:w-[520px]">
                <select
                  value={taskFilter}
                  onChange={(e) => setTaskFilter(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="overdue">Overdue</option>
                  <option value="due_today">Due Today</option>
                  <option value="high_urgent">High/Urgent</option>
                </select>
                <input
                  type="search"
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search title, notes, customer, supplier, product"
                  className="rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {filteredTasks.length === 0 ? (
              <p className="text-sm text-gray-600">No tasks match the current filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Task</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Priority</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Due</th>
                      <th className="px-3 py-2">Related</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredTasks.map((task) => {
                      const customer = customers.find((item) => item.id === task.customer_id);
                      const supplier = suppliers.find((item) => item.id === task.supplier_id);
                      const product = products.find((item) => String(item.id) === String(task.product_id));
                      const purchase = purchaseTransactions.find((item) => item.id === task.purchase_transaction_id);
                      const sale = salesTransactions.find((item) => item.id === task.sales_transaction_id);
                      const dueDate = getDateOnly(task.due_date);
                      const isOverdue =
                        task.status !== "completed" &&
                        task.status !== "cancelled" &&
                        Boolean(dueDate && dueDate < todayDateValue);

                      return (
                        <tr key={task.id}>
                          <td className="px-3 py-3">
                            <div className="font-medium text-gray-900">{task.title}</div>
                            {task.notes && <div className="mt-1 text-xs text-gray-500">{task.notes}</div>}
                          </td>
                          <td className="px-3 py-3">{taskTypeLabels[task.task_type] ?? task.task_type}</td>
                          <td className="px-3 py-3">{taskPriorityLabels[task.priority] ?? task.priority}</td>
                          <td className="px-3 py-3">
                            <span className={`rounded px-2 py-1 text-xs font-medium ${
                              task.status === "completed"
                                ? "bg-green-100 text-green-700"
                                : task.status === "cancelled"
                                  ? "bg-gray-100 text-gray-700"
                                  : isOverdue
                                    ? "bg-red-100 text-red-700"
                                    : "bg-blue-100 text-blue-700"
                            }`}>
                              {isOverdue ? "Overdue" : taskStatusLabels[task.status] ?? task.status}
                            </span>
                          </td>
                          <td className="px-3 py-3">{dueDate ?? "No due date"}</td>
                          <td className="px-3 py-3 text-xs text-gray-600">
                            {customer && <div>Customer: {customer.customer_name}</div>}
                            {supplier && <div>Supplier: {supplier.supplier_name}</div>}
                            {product && <div>Product: {product.name}</div>}
                            {purchase && <div>Purchase: {purchase.invoice_number}</div>}
                            {sale && <div>Sale: {sale.invoice_number}</div>}
                            {!customer && !supplier && !product && !purchase && !sale && <div>-</div>}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-2">
                              {task.status !== "in_progress" && task.status !== "completed" && task.status !== "cancelled" && (
                                <button
                                  type="button"
                                  onClick={() => updateTaskStatus(task.id, "in_progress")}
                                  className="rounded border border-blue-600 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                                >
                                  Mark In Progress
                                </button>
                              )}
                              {task.status !== "completed" && task.status !== "cancelled" && (
                                <button
                                  type="button"
                                  onClick={() => updateTaskStatus(task.id, "completed")}
                                  className="rounded border border-green-600 px-2 py-1 text-xs text-green-700 hover:bg-green-50"
                                >
                                  Mark Completed
                                </button>
                              )}
                              {task.status !== "cancelled" && task.status !== "completed" && (
                                <button
                                  type="button"
                                  onClick={() => updateTaskStatus(task.id, "cancelled")}
                                  className="rounded border border-gray-400 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                                >
                                  Cancel Task
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        )}

        {activeSectionAllowed && activeSection === "business-settings" && (
        <section className="mt-8 rounded border border-gray-200 bg-gray-50 p-5">
          <h2 className="mb-4 text-xl font-medium text-gray-900">Business Settings</h2>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Business Name</span>
                <input
                  type="text"
                  value={businessSettingsName}
                  onChange={(e) => setBusinessSettingsName(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Phone</span>
                <input
                  type="text"
                  value={businessSettingsPhone}
                  onChange={(e) => setBusinessSettingsPhone(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>Address</span>
                <input
                  type="text"
                  value={businessSettingsAddress}
                  onChange={(e) => setBusinessSettingsAddress(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-700">
                <span>City</span>
                <input
                  type="text"
                  value={businessSettingsCity}
                  onChange={(e) => setBusinessSettingsCity(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Invoice Footer Note</span>
              <textarea
                value={businessSettingsInvoiceFooterNote}
                onChange={(e) => setBusinessSettingsInvoiceFooterNote(e.target.value)}
                rows={3}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>Default Payment Terms</span>
              <textarea
                value={businessSettingsDefaultPaymentTerms}
                onChange={(e) => setBusinessSettingsDefaultPaymentTerms(e.target.value)}
                rows={2}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>

            <button
              type="button"
              onClick={handleSaveBusinessSettings}
              disabled={businessSettingsLoading}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {businessSettingsLoading ? "Saving..." : "Save Business Settings"}
            </button>
          </div>

          {businessSettingsMessage && (
            <p className="mt-4 text-sm text-green-700">{businessSettingsMessage}</p>
          )}
          {businessSettingsError && (
            <p className="mt-4 whitespace-pre-wrap text-sm text-red-700">{businessSettingsError}</p>
          )}
        </section>
        )}

        {activeSectionAllowed && activeSection === "products" && (
          <>
            {message && <p className="mt-4 text-sm text-green-700">{message}</p>}
            {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
          </>
        )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}


