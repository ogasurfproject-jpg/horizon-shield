# w3id.org permanent identifier for the A2A Conduct Extension (PR contents)

Repository: https://github.com/perma-id/w3id.org  (fork, add the directory below, open a PR; the maintainers merge within days)

Directory to add at the repository root: `horizonshield/`

Two files:

`horizonshield/README.md`
```
# horizonshield

Permanent identifiers for HORIZON SHIELD specifications (The HORIZ音s株式会社, Hiratsuka, Japan).

- https://w3id.org/horizonshield/conduct/v1 redirects to https://gate.horizonshield.dev/ext/conduct/v1
  (A2A Conduct Extension v1; the target serves JSON by default and the specification text with Accept: text/markdown)

Contact: ogasurfproject@gmail.com  (GitHub: ogasurfproject-jpg)
```

`horizonshield/.htaccess`
```
Options +FollowSymLinks
RewriteEngine on

# A2A Conduct Extension v1. The identifier compared by implementations is the target URI; this is a convenience redirect.
RewriteRule ^conduct/v1/?$ https://gate.horizonshield.dev/ext/conduct/v1 [R=302,L]
RewriteRule ^conduct/?$ https://gate.horizonshield.dev/ext/conduct/v1 [R=302,L]
```

Notes for the PR description: "Adds horizonshield/ with a redirect for the A2A Conduct Extension v1 specification. Owner: ogasurfproject-jpg." Keep it to two sentences; the w3id maintainers review the .htaccess only.

What this does not change: CONDUCT_EXT_v1.md section 7 says a w3id redirect is a convenience, not a second identifier. Cards keep declaring `https://gate.horizonshield.dev/ext/conduct/v1`. The w3id URI is for citations and papers that outlive a hostname.
