# iPhone reference research — October 13, 2026

Apple lists iOS 27.0.1 as current, released September 28, 2026: https://support.apple.com/en-us/100100 . About and Software Update use this reference, with no invented next update. The represented iPhone 15 Pro remains compatible; updating the software does not require inventing different hardware.

Sources inspected:
- https://www.apple.com/os/ios/ — iOS27 retains Liquid Glass, with contrast refinements and customizable tint; Siri AI, Mail and parental-control enhancements also described.
- https://support.apple.com/en-euro/guide/iphone/welcome/ios — current iOS27 navigation and supported models.
- https://support.apple.com/en-euro/guide/iphone/iph59095ec58/ios — Control Center top-right gesture; Wi-Fi/Bluetooth buttons temporarily disconnect rather than disable radios; Settings switches turn them off.
- https://support.apple.com/en-euro/guide/iphone/iph60ba71065/ios — Display & Brightness paths.
- https://support.apple.com/en-euro/guide/iphone/iphw5gjwl8k2/ios — Wi-Fi Info, Forget, DNS, HTTP Proxy and network settings.
- https://support.apple.com/en-euro/guide/iphone/iph3dd5fc7e/ios — About information.

The existing single-file project was preserved before creating iphone. Its existing applications/navigation are retained; CSS and JavaScript are split into local assets for maintainable corrections. Existing iphone-sim-v2 localStorage profiles are retained on the same origin; deployment path change itself does not change the origin. Different origins or local ports have separate browser storage.

Not assessed: exact pixel parity against native hardware, proprietary SF Symbols/font/artwork, native binaries/kernel, modem/Bluetooth hardware, Apple/Siri AI services, real authentication/payment/mail delivery, unrestricted browser embedding. New iOS27 AI and full parental controls remain incomplete. Some secondary legacy controls remain placeholder actions. Stored DNS/IP/proxy data is virtual and does not configure the host network.
