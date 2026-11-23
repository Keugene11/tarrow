import Foundation
import AuthenticationServices
import Capacitor

/// Native Sign in with Apple. Returns Apple's identity token; the server verifies it (/api/auth/apple).
/// Registered in TarrowViewController because local app plugins aren't discovered by `cap sync`.
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "TarrowAppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            if let nonce = call.getString("nonce") {
                request.nonce = nonce
            }
            self.pendingCall = call
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple returned no identity token")
            return
        }
        call.resolve([
            "identityToken": identityToken,
            "user": credential.user,
            "email": credential.email ?? "",
            "givenName": credential.fullName?.givenName ?? "",
            "familyName": credential.fullName?.familyName ?? ""
        ])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("cancelled", "CANCELLED")
        } else {
            call.reject(error.localizedDescription)
        }
    }
}
