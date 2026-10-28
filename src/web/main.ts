// The iPad web app: bridge.ts stands in for Electron's preload, then the same renderer as the
// Windows app starts. The order matters: the renderer's lib/api.ts reads window.api as soon as
// it loads.
import './bridge'
import '../renderer/src/main'
