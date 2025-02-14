package app.omnivore.omnivore.core.network

import app.omnivore.omnivore.utils.Constants
import app.omnivore.omnivore.utils.DatastoreKeys
import app.omnivore.omnivore.core.datastore.DatastoreRepository
import com.apollographql.apollo3.ApolloClient
import javax.inject.Inject

class Networker @Inject constructor(
  private val datastoreRepo: DatastoreRepository
) {
  suspend fun baseUrl() = datastoreRepo.getString(DatastoreKeys.omnivoreSelfHostedAPIServer) ?: Constants.apiURL

  suspend fun serverUrl() = "${baseUrl()}/api/graphql"
  private suspend fun authToken() = datastoreRepo.getString(DatastoreKeys.omnivoreAuthToken) ?: ""

  suspend fun publicApolloClient() = ApolloClient.Builder()
    .serverUrl(serverUrl())
    .build()

  suspend fun authenticatedApolloClient() = ApolloClient.Builder()
    .serverUrl(serverUrl())
    .addHttpHeader("Authorization", value = authToken())
    .build()
}
