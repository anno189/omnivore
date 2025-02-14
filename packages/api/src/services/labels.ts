import { DeepPartial, FindOptionsWhere, In } from 'typeorm'
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity'
import { EntityLabel, LabelSource } from '../entity/entity_label'
import { Label } from '../entity/label'
import { createPubSubClient, EntityType, PubsubClient } from '../pubsub'
import { authTrx } from '../repository'
import { CreateLabelInput, labelRepository } from '../repository/label'
import { bulkEnqueueUpdateLabels } from '../utils/createTask'
import { findHighlightById } from './highlights'
import { findLibraryItemIdsByLabelId } from './library_item'

type AddLabelsToLibraryItemEvent = {
  pageId: string
  labels: DeepPartial<Label>[]
  source?: LabelSource
}
type AddLabelsToHighlightEvent = {
  highlightId: string
  labels: DeepPartial<Label>[]
}

// const batchGetLabelsFromLinkIds = async (
//   linkIds: readonly string[]
// ): Promise<Label[][]> => {
//   const links = await getRepository(Link).find({
//     where: { id: In(linkIds as string[]) },
//     relations: ['labels'],
//   })

//   return linkIds.map(
//     (linkId) => links.find((link) => link.id === linkId)?.labels || []
//   )
// }

// export const labelsLoader = new DataLoader(batchGetLabelsFromLinkIds)

export const findOrCreateLabels = async (
  labels: CreateLabelInput[],
  userId: string
): Promise<Label[]> => {
  // create labels if not exist
  await authTrx(
    async (tx) =>
      tx.withRepository(labelRepository).createLabels(labels, userId),
    undefined,
    userId
  )

  // find labels
  return authTrx(
    async (tx) =>
      tx.withRepository(labelRepository).findByNames(
        labels.map((l) => l.name),
        userId
      ),
    undefined,
    userId
  )
}

export const createAndSaveLabelsInLibraryItem = async (
  libraryItemId: string,
  userId: string,
  labels?: CreateLabelInput[] | null,
  rssFeedUrl?: string | null,
  source?: LabelSource,
  pubsub?: PubsubClient
) => {
  if (rssFeedUrl) {
    // add rss label to labels
    labels = (labels || []).concat({ name: 'RSS' })
    source = 'system'
  }

  // save labels in item
  if (labels && labels.length > 0) {
    const newLabels = await findOrCreateLabels(labels, userId)

    await saveLabelsInLibraryItem(
      newLabels,
      libraryItemId,
      userId,
      source,
      pubsub
    )
  }
}

export const saveLabelsInLibraryItem = async (
  labels: Label[],
  libraryItemId: string,
  userId: string,
  source: LabelSource = 'user',
  pubsub = createPubSubClient()
) => {
  await authTrx(
    async (tx) => {
      const repo = tx.getRepository(EntityLabel)

      // delete existing labels
      await repo.delete({
        libraryItemId,
      })

      // save new labels
      await repo.save(
        labels.map((l) => ({
          labelId: l.id,
          libraryItemId,
          source,
        }))
      )
    },
    undefined,
    userId
  )

  if (source === 'user') {
    // create pubsub event
    await pubsub.entityCreated<AddLabelsToLibraryItemEvent>(
      EntityType.LABEL,
      { pageId: libraryItemId, labels, source },
      userId
    )
  }

  // update labels in library item
  return bulkEnqueueUpdateLabels([{ libraryItemId, userId }])
}

export const addLabelsToLibraryItem = async (
  labelIds: string[],
  libraryItemId: string,
  userId: string,
  source: LabelSource = 'user'
) => {
  await authTrx(
    async (tx) => {
      await tx.query(
        `INSERT INTO omnivore.entity_labels (label_id, library_item_id, source)
          SELECT id, $1, $2 FROM omnivore.labels
          WHERE id = ANY($3)
          AND NOT EXISTS (
            SELECT 1 FROM omnivore.entity_labels
            WHERE label_id = labels.id
            AND library_item_id = $1
          )`,
        [libraryItemId, source, labelIds]
      )
    },
    undefined,
    userId
  )

  // update labels in library item
  await bulkEnqueueUpdateLabels([{ libraryItemId, userId }])
}

export const saveLabelsInHighlight = async (
  labels: Label[],
  highlightId: string,
  userId: string,
  pubsub = createPubSubClient()
) => {
  await authTrx(async (tx) => {
    const repo = tx.getRepository(EntityLabel)

    // delete existing labels
    await repo.delete({
      highlightId,
    })

    // save new labels
    await repo.save(
      labels.map((l) => ({
        labelId: l.id,
        highlightId,
      }))
    )
  })

  // create pubsub event
  await pubsub.entityCreated<AddLabelsToHighlightEvent>(
    EntityType.LABEL,
    { highlightId, labels },
    userId
  )

  const highlight = await findHighlightById(highlightId, userId)
  if (highlight) {
    // update labels in library item
    await bulkEnqueueUpdateLabels([
      { libraryItemId: highlight.libraryItemId, userId },
    ])
  }
}

export const findLabelsByIds = async (
  ids: string[],
  userId: string
): Promise<Label[]> => {
  return authTrx(
    async (tx) => {
      return tx.withRepository(labelRepository).findBy({
        id: In(ids),
        user: { id: userId },
      })
    },
    undefined,
    userId
  )
}

export const createLabel = async (
  name: string,
  color: string,
  userId: string
): Promise<Label> => {
  return authTrx(
    (t) =>
      t.withRepository(labelRepository).createLabel({ name, color }, userId),
    undefined,
    userId
  )
}

export const deleteLabels = async (
  criteria: string[] | FindOptionsWhere<Label>,
  userId: string
) => {
  return authTrx(
    async (t) => t.withRepository(labelRepository).delete(criteria),
    undefined,
    userId
  )
}

export const deleteLabelById = async (labelId: string, userId: string) => {
  const libraryItemIds = await findLibraryItemIdsByLabelId(labelId, userId)

  const deleteResult = await authTrx(async (tx) => {
    return tx.withRepository(labelRepository).deleteById(labelId)
  })

  if (!deleteResult.affected) {
    return false
  }

  const data = libraryItemIds.map((libraryItemId) => ({
    libraryItemId,
    userId,
  }))
  await bulkEnqueueUpdateLabels(data)

  return true
}

export const updateLabel = async (
  id: string,
  label: QueryDeepPartialEntity<Label>,
  userId: string
) => {
  const updatedLabel = await authTrx(
    async (t) => {
      const repo = t.withRepository(labelRepository)
      await repo.updateLabel(id, label)

      return repo.findOneByOrFail({ id })
    },
    undefined,
    userId
  )

  const libraryItemIds = await findLibraryItemIdsByLabelId(id, userId)

  const data = libraryItemIds.map((libraryItemId) => ({
    libraryItemId,
    userId,
  }))
  await bulkEnqueueUpdateLabels(data)

  return updatedLabel
}

export const findLabelsByUserId = async (userId: string): Promise<Label[]> => {
  return authTrx(
    async (tx) =>
      tx.withRepository(labelRepository).find({
        where: { user: { id: userId } },
        order: { position: 'ASC' },
      }),
    undefined,
    userId
  )
}

export const findLabelById = async (id: string, userId: string) => {
  return authTrx(
    async (tx) =>
      tx
        .withRepository(labelRepository)
        .findOneBy({ id, user: { id: userId } }),
    undefined,
    userId
  )
}

export const findLabelsByLibraryItemId = async (
  libraryItemId: string,
  userId: string
): Promise<(Label & { source: string })[]> => {
  return authTrx(
    async (tx) => {
      const entityLabels = await tx.getRepository(EntityLabel).find({
        where: { libraryItemId },
        relations: ['label'],
      })

      return entityLabels.map((el) => ({
        ...el.label,
        source: el.source,
      }))
    },
    undefined,
    userId
  )
}
