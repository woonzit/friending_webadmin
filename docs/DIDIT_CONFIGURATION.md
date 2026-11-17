# Identity provider configuration

Configuration includes the `IdentityVerificationConfiguration` panel. It
reads/saves Core's `identity_verification_configuration` routes through the
existing same-origin admin bridge. Active membership and write role are
rechecked by Core. A viewer sees a disabled editor.

The exact contract includes provider (`persona`, `didit`, `disabled`), minimum
iOS build, workflow UUID, revision, legacy provider, write permission, and
boolean Didit environment/credential/media-host readiness. Provider secrets
are never browser fields. Unknown/malformed payloads fail closed. Conflicts
and uncertain writes reload authoritative state before another save.

The switch affects only iOS builds that explicitly support identity contract
1. Older apps continue Persona. Pause stops new capable-client checks;
unfinished Didit sessions can still finish. Default and rollback are Persona.

Deploy Core and its guarded indexes before Webadmin. Before activation,
complete the provider credential/webhook/media checks and physical-device
verification described in Core's `docs/DIDIT_IDENTITY_VERIFICATION.md`.
The readiness badges report configured prerequisites, not a successful
end-to-end provider test.
