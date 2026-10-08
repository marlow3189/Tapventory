// Skaner kodów w przeglądarce: wskazujemy bibliotece NASZ plik .wasm (public/zxing_reader.wasm,
// kopiowany skryptem scripts/copy-wasm.mjs) zamiast domyślnego CDN. Patrz uwagi w tamtym skrypcie.

export function configureWebBarcodeWasm(): void {
  void import('barcode-detector')
    .then(({ prepareZXingModule }) => {
      prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? '/zxing_reader.wasm' : prefix + path),
        },
      });
    })
    .catch(() => {
      // bez tego skaner w przeglądarce użyje domyślnego CDN — nie blokujemy startu aplikacji
    });
}
