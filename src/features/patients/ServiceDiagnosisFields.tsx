import { TapToEditField } from '@/lib/inlineEdit/TapToEditField'
import { MentionText, PhotoMentionField, type MentionablePhoto } from '@/features/photos/photoMentions'
import { TagChip } from '@/features/tags/TagChip'
import type { Patient, TagDefinition } from '@/types'
import { orderedServiceEntries } from './serviceDiagnosis'

/** Renders a diagnosis bucket (Admission or Discharge): a single free-text field while the patient
 * has zero Main/Referral services, or one field per assigned service (Main first, then Referral)
 * once at least one exists. */
export const ServiceDiagnosisFields = ({
  patient,
  tagsById,
  unassigned,
  byService,
  onChangeUnassigned,
  onChangeService,
  label,
  mentionableAttachments,
  attachmentByTitle,
  onOpenPhotoById,
}: {
  patient: Pick<Patient, 'mainServiceTagIds' | 'referralServiceTagIds'>
  tagsById: Map<number, TagDefinition>
  unassigned: string
  byService: Record<number, string>
  onChangeUnassigned: (text: string) => void
  onChangeService: (serviceTagId: number, text: string) => void
  label: string
  mentionableAttachments: MentionablePhoto[]
  attachmentByTitle: Map<string, MentionablePhoto>
  onOpenPhotoById: (id: number) => void
}) => {
  const serviceEntries = orderedServiceEntries(patient)

  if (serviceEntries.length === 0) {
    return (
      <TapToEditField
        ariaLabel={label}
        emptyText={`Tap to add ${label.toLowerCase()}`}
        value={unassigned}
        onCommit={onChangeUnassigned}
        renderView={(text) => <MentionText text={text} attachmentByTitle={attachmentByTitle} onOpenPhotoById={onOpenPhotoById} />}
        renderEditor={({ value, onChange }) => (
          <PhotoMentionField
            ariaLabel={label}
            placeholder={label}
            className='min-h-24'
            value={value}
            onChange={onChange}
            attachments={mentionableAttachments}
            attachmentByTitle={attachmentByTitle}
            onOpenPhotoById={onOpenPhotoById}
          />
        )}
      />
    )
  }

  return (
    <div className='space-y-3'>
      {serviceEntries.map(({ tagId, role }) => {
        const tag = tagsById.get(tagId)
        const serviceName = tag?.name ?? `Service #${tagId}`
        const roleMarker = role === 'main' ? 'M' : 'R'
        return (
          <div key={tagId} className='space-y-1'>
            {tag ? (
              <TagChip tag={tag} roleMarker={roleMarker} />
            ) : (
              <p className='text-xs font-semibold text-espresso'>{serviceName}</p>
            )}
            <TapToEditField
              ariaLabel={`${label} — ${serviceName}`}
              emptyText={`Tap to add ${serviceName} ${label.toLowerCase()}`}
              value={byService[tagId] ?? ''}
              onCommit={(text) => onChangeService(tagId, text)}
              renderView={(text) => <MentionText text={text} attachmentByTitle={attachmentByTitle} onOpenPhotoById={onOpenPhotoById} />}
              renderEditor={({ value, onChange }) => (
                <PhotoMentionField
                  ariaLabel={`${label} — ${serviceName}`}
                  placeholder={`${serviceName} ${label}`}
                  className='min-h-16'
                  value={value}
                  onChange={onChange}
                  attachments={mentionableAttachments}
                  attachmentByTitle={attachmentByTitle}
                  onOpenPhotoById={onOpenPhotoById}
                />
              )}
            />
          </div>
        )
      })}
    </div>
  )
}
