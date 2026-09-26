// Minimal stub of a2a.AgentCardSignature. Field set and JSON tags copied from
// a2aproject/a2a-go v2.6.0 a2a/agent.go so verify.go compiles without the full module.
package a2a

type AgentCardSignature struct {
	Header    map[string]any `json:"header,omitempty"`
	Protected string         `json:"protected"`
	Signature string         `json:"signature"`
}
