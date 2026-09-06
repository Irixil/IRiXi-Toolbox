enum BuildVariant {
    #if OFFLINE
    static let isOffline = true
    static let displayName = "Snaploom Offline"
    #else
    static let isOffline = false
    static let displayName = "Snaploom"
    #endif
}
