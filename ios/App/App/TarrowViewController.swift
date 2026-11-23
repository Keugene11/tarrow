import UIKit
import Capacitor

/// Bridge view controller that registers Tarrow's local native plugins (set as the storyboard's root).
class TarrowViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AppleSignInPlugin())
    }
}
