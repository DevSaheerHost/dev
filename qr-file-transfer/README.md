# QRTransfer

QRTransfer is an air-gapped file transfer web application that allows files to be transferred between devices using QR codes instead of a network connection.

The application splits a file into small data chunks, converts each chunk into a QR code, and displays the QR codes sequentially. The receiving device scans the QR codes and reconstructs the original file.

## ✨ Features

- 📡 Air-gapped file transfer
- 📤 Send files through QR code sequences
- 📥 Receive files by scanning QR codes
- 📷 Camera-based QR scanning
- 📋 Manual QR data input
- 📁 Supports arbitrary file types
- 🧩 Configurable chunk sizes
- 🔳 Configurable QR error-correction level
- ▶️ Manual or automatic QR sequence playback
- 📊 Transfer progress tracking
- 🔐 No network connection required for file transfer
- 📱 Mobile-friendly dark interface
- 💾 Reconstruct and download received files

## 🚀 How It Works

**Sender**

1. Open QRTransfer on the sending device.
2. Select a file.
3. Choose the desired chunk size.
4. Select the QR error-correction level.
5. Generate the QR sequence.
6. Display each QR code to the receiving device.
7. Navigate manually or use automatic playback.

**Receiver**

1. Open QRTransfer on the receiving device.
2. Switch to Receive.
3. Open the camera.
4. Scan each QR code in the sequence.
5. The application collects and validates the chunks.
6. Once all chunks are received, the original file is reconstructed.
7. Download the resulting file.

## ⚙️ Chunk Configuration

QRTransfer provides multiple chunk sizes:

Size| Purpose
300 B| Higher compatibility
500 B| Balanced
800 B| Faster transfers
1200 B| Maximum density

Smaller chunks generally produce more QR codes but can be easier for cameras to decode.

## 🔳 QR Error Correction

The sender can choose between different QR error-correction levels:

- L — Higher data density
- M — Medium correction
- Q — Lower data density

Higher error correction can improve reliability when QR codes are partially obscured or difficult to scan, but reduces available data capacity.

## 🛡️ Privacy

QRTransfer is designed around offline, device-to-device transfer.

No file upload server is required for the QR transfer process. The file data is represented directly inside the QR sequence.

«Do not assume that QR encoding alone provides encryption. If sensitive files are being transferred, encryption should be implemented before encoding the file into QR chunks.»

## 🧰 Technologies

- HTML5
- CSS3
- JavaScript
- HTML File API
- Canvas API
- Web Camera APIs
- QR encoding/decoding

The interface uses a dark futuristic design with Space Grotesk and Space Mono typography.

## 📱 Interface

QRTransfer contains two primary modes:

Send

Used to select a file, configure transfer parameters, generate QR chunks, and control QR playback.

Receive

Used to scan QR codes, collect chunks, verify the transfer, reconstruct the file, and download it.

## ⚠️ Limitations

QR-based file transfer is inherently slower than Wi-Fi, Bluetooth, USB, or direct network transfer.

Large files may require a significant number of QR codes, especially when using smaller chunk sizes.

Camera quality, lighting, screen brightness, QR size, and scanning distance can affect reliability.

## 🔮 Future Improvements

Possible future improvements include:

- 🔒 End-to-end encryption
- 🔍 Automatic QR detection optimization
- 🔄 Automatic missing-chunk recovery
- 🧮 Better checksum validation
- 📦 File compression
- 📈 Transfer speed estimation
- ⏸️ Resume interrupted transfers
- 🔊 Audio-assisted transfer mode
- 🖥️ Desktop optimization
- 📱 PWA installation support
- 🧵 Web Worker-based encoding for large files

## 📄 License

Add your preferred license here.

---

QRTransfer
Transfer files. No network required.