/**
 * Browser drawer transports (Route 2 direct + Route 1 print assist).
 *
 * WebSerial / WebUSB are Chrome-only, HTTPS-only, and pairing needs a
 * user gesture — pairing therefore happens once from the till's drawer
 * settings ("Connect printer"), and the granted handles are kept in
 * module memory for the session (they cannot be serialized). Later
 * kicks reuse previously-granted devices via getPorts()/getDevices().
 *
 * On Windows tills prefer WebSerial: the printer driver exclusively
 * claims USB printers, while the driver's virtual COM port stays
 * available to WebSerial (spec Q3/Q6).
 *
 * Every function here either resolves or throws a short cause string;
 * kickDrawer (drawer.ts) converts throws into recorded failures.
 */
import type { DrawerEventType, DrawerTransports } from "./drawer";

// Minimal structural shapes for the WebSerial / WebUSB surfaces — the
// standard TS DOM lib does not type them, and this module is the single
// place that touches the raw navigator objects.
interface SerialWriterLike {
  write(data: Uint8Array): Promise<void>;
  releaseLock(): void;
}
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: { getWriter(): SerialWriterLike } | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}
interface UsbEndpointLike {
  direction: string;
  endpointNumber: number;
  type: string;
}
interface UsbDeviceLike {
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<unknown>;
  configuration: {
    interfaces: Array<{
      interfaceNumber: number;
      alternate: { endpoints: UsbEndpointLike[] };
    }>;
  } | null;
}
interface UsbLike {
  requestDevice(options: { filters: Array<{ vendorId: number }> }): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
}

function serialApi(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as unknown as { serial?: SerialLike }).serial;
  return candidate ?? null;
}

function usbApi(): UsbLike | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as unknown as { usb?: UsbLike }).usb;
  return candidate ?? null;
}

export function hasDrawerSerial(): boolean {
  return serialApi() !== null;
}

export function hasDrawerUsb(): boolean {
  return usbApi() !== null;
}

// Granted devices, kept for the page session. Pairing is per till and
// per browser profile, matching how Chrome grants these permissions.
let grantedSerialPort: SerialPortLike | null = null;
let grantedUsbDevice: UsbDeviceLike | null = null;

/** Pair a serial printer (user gesture required). Returns false when
 * the user cancels or the API is unavailable. */
export async function connectDrawerSerial(): Promise<boolean> {
  const serial = serialApi();
  if (!serial) return false;
  try {
    grantedSerialPort = await serial.requestPort();
    return true;
  } catch {
    return false;
  }
}

// Common ESC/POS receipt-printer USB vendors (Epson, Star, BIXOLON,
// Citizen, SNBC, Xprinter-class). Pairing must offer at least one
// filter — Chrome has no "any device" mode for WebUSB.
const USB_PRINTER_VENDOR_IDS = [0x04b8, 0x0519, 0x1504, 0x2730, 0x154f, 0x0fe6, 0x0483, 0x1a86];

/** Pair a USB printer (user gesture required). */
export async function connectDrawerUsb(): Promise<boolean> {
  const usb = usbApi();
  if (!usb) return false;
  try {
    grantedUsbDevice = await usb.requestDevice({
      filters: USB_PRINTER_VENDOR_IDS.map((vendorId) => ({ vendorId })),
    });
    return true;
  } catch {
    return false;
  }
}

async function writeDrawerSerial(bytes: Uint8Array): Promise<void> {
  const serial = serialApi();
  if (!serial) throw new Error("webserial-unavailable");
  let port = grantedSerialPort;
  if (!port) {
    const granted = await serial.getPorts();
    port = granted[0] ?? null;
    if (port) grantedSerialPort = port;
  }
  if (!port) throw new Error("no-serial-port");
  await port.open({ baudRate: 9600 });
  try {
    const writer = port.writable?.getWriter();
    if (!writer) throw new Error("serial-not-writable");
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  } finally {
    await port.close().catch(() => undefined);
  }
}

async function writeDrawerUsb(bytes: Uint8Array): Promise<void> {
  const usb = usbApi();
  if (!usb) throw new Error("webusb-unavailable");
  let device = grantedUsbDevice;
  if (!device) {
    const granted = await usb.getDevices();
    device = granted[0] ?? null;
    if (device) grantedUsbDevice = device;
  }
  if (!device) throw new Error("no-usb-device");
  await device.open();
  try {
    if (!device.configuration) await device.selectConfiguration(1);
    const iface = device.configuration?.interfaces[0];
    if (!iface) throw new Error("usb-no-interface");
    await device.claimInterface(iface.interfaceNumber);
    const endpoint = iface.alternate.endpoints.find(
      (candidate) => candidate.direction === "out" && candidate.type === "bulk",
    ) ?? iface.alternate.endpoints.find((candidate) => candidate.direction === "out");
    if (!endpoint) throw new Error("usb-no-out-endpoint");
    await device.transferOut(endpoint.endpointNumber, bytes);
  } finally {
    await device.close().catch(() => undefined);
  }
}

/**
 * Print route. For a cash sale / cash refund the kick rides the sale's
 * own receipt print job through the driver (Document Bottom), so there
 * is nothing extra to send — resolving here records the delegation.
 * For a manual open there is no receipt, so a minimal slip is printed
 * through the same driver profile to push a job (and its kick) out.
 */
function printDrawerKick(eventType: DrawerEventType, slipText: string): Promise<void> {
  if (eventType === "cash-sale" || eventType === "cash-refund") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      reject(new Error("print-unavailable"));
      return;
    }
    const frame = document.createElement("iframe");
    frame.title = "Drawer open slip";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    const cleanup = () => frame.remove();
    frame.addEventListener("load", () => {
      const target = frame.contentWindow;
      if (!target || typeof target.print !== "function") {
        cleanup();
        reject(new Error("print-unavailable"));
        return;
      }
      try {
        target.focus();
        target.print();
        resolve();
      } catch {
        reject(new Error("print-failed"));
      } finally {
        window.setTimeout(cleanup, 1500);
      }
    }, { once: true });
    const escaped = slipText.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    frame.srcdoc = `<!doctype html><html><body style="font-family:monospace;font-size:12px">${escaped}</body></html>`;
    document.body.appendChild(frame);
  });
}

/** Production transports. `slipText` labels the manual-open print slip
 * (already localized by the caller). */
export function createBrowserDrawerTransports(slipText: string): DrawerTransports {
  return {
    print: (eventType) => printDrawerKick(eventType, slipText),
    serial: writeDrawerSerial,
    usb: writeDrawerUsb,
  };
}
