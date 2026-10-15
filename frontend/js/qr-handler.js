// qr-handler.js
// Handles QR Code generation and Camera/File-based QR Scanning.
// Integrates QRCode.js and html5-qrcode libraries.

class SmartLibraryQR {
  constructor() {
    this.html5QrCode = null;
  }

  // Generate a QR Code in a target HTML element
  generate(containerElement, text, width = 160, height = 160) {
    if (!containerElement) return;
    containerElement.innerHTML = ""; // Clear container

    try {
      if (typeof QRCode !== 'undefined') {
        new QRCode(containerElement, {
          text: text,
          width: width,
          height: height,
          colorDark: "#0f172a", // Slate-900 for high contrast
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      } else {
        // Fallback: If CDN failed to load, show standard message with text
        containerElement.innerHTML = `<div class="qr-fallback-txt" style="word-break: break-all; padding: 10px; border: 1px dashed #7c3aed; font-size:12px;">${text}</div>`;
      }
    } catch (err) {
      console.error("QR Code generation error:", err);
      containerElement.innerHTML = "<span class='text-red-500'>Error generating QR Code</span>";
    }
  }

  // Start Camera QR Scanner
  async startScanner(elementId, onScanSuccess, onScanFailure) {
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error("Html5Qrcode scanner library is not loaded.");
    }

    // Stop current scanner if running
    await this.stopScanner();

    this.html5QrCode = new Html5Qrcode(elementId);
    const config = {
      fps: 10,
      qrbox: (width, height) => {
        const size = Math.min(width, height) * 0.7;
        return { width: size, height: size };
      }
    };

    return this.html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText, decodedResult) => {
        onScanSuccess(decodedText, decodedResult);
      },
      (errorMessage) => {
        if (onScanFailure) {
          onScanFailure(errorMessage);
        }
      }
    ).catch(err => {
      this.html5QrCode = null;
      console.error("Failed to start QR scanner:", err);
      throw err;
    });
  }

  // Stop Camera QR Scanner
  async stopScanner() {
    if (this.html5QrCode && this.html5QrCode.isScanning) {
      try {
        await this.html5QrCode.stop();
      } catch (err) {
        console.error("Error stopping QR scanner:", err);
      }
    }
    this.html5QrCode = null;
  }

  // Scan QR Code from an uploaded Image file
  async scanFile(file, onScanSuccess, onScanFailure) {
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error("Html5Qrcode scanner library is not loaded.");
    }

    const tempScanner = new Html5Qrcode("qr-file-scanner-temp");
    try {
      const decodedText = await tempScanner.scanFile(file, true);
      onScanSuccess(decodedText);
      tempScanner.clear();
    } catch (err) {
      tempScanner.clear();
      if (onScanFailure) {
        onScanFailure(err);
      } else {
        console.error("QR code file scan error:", err);
      }
    }
  }

  // Parse Smart Library protocol QR codes
  // Formats:
  // - smartlib://book/{bookId}
  // - smartlib://member/{memberId}
  parseCode(decodedText) {
    if (decodedText.startsWith("smartlib://")) {
      const parts = decodedText.replace("smartlib://", "").split("/");
      if (parts.length >= 2) {
        return {
          type: parts[0], // "book" or "member"
          id: parts[1]
        };
      }
    }
    // Fallback if it is just a plain ID
    if (decodedText.startsWith("book_") || decodedText.length === 20 || decodedText.startsWith("mem_")) {
      const type = decodedText.startsWith("book_") ? "book" : (decodedText.startsWith("mem_") ? "member" : "unknown");
      return { type, id: decodedText };
    }
    return { type: "unknown", id: decodedText };
  }
}

// Instantiate globally
window.smartLibQR = new SmartLibraryQR();
