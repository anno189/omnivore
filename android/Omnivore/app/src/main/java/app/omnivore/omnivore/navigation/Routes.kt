package app.omnivore.omnivore.navigation

sealed class Routes(val route: String) {
    object Library : Routes("Library")
    object Settings : Routes("Settings")
    object Search : Routes("Search")
    object Documentation : Routes("Documentation")
    object PrivacyPolicy : Routes("PrivacyPolicy")
    object TermsAndConditions : Routes("TermsAndConditions")
    object Notebook : Routes("Notebook")
}
