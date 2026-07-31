export function dedupeResumeImages(images = []) {
  const seenDataUrls = new Set();
  const unique = [];
  for (const image of Array.isArray(images) ? images : []) {
    const dataUrl = String(image?.dataUrl || '');
    if (dataUrl) {
      if (seenDataUrls.has(dataUrl)) continue;
      seenDataUrls.add(dataUrl);
    }
    unique.push(image);
  }
  return unique;
}

export function mergeResumeImages(existing = [], incoming = []) {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const uniqueExisting = dedupeResumeImages(existingList);
  const images = dedupeResumeImages([...uniqueExisting, ...incomingList]);
  return {
    images,
    added: images.length - uniqueExisting.length,
    duplicates: existingList.length + incomingList.length - images.length
  };
}

export function normalizeResumes(resumes = {}) {
  const source = resumes && typeof resumes === 'object' ? resumes : {};
  return {
    ...source,
    profiles: (Array.isArray(source.profiles) ? source.profiles : []).map((profile) => ({
      ...profile,
      images: dedupeResumeImages(profile?.images)
    }))
  };
}

export function countResumeImages(resumes = {}) {
  return (Array.isArray(resumes?.profiles) ? resumes.profiles : [])
    .reduce((total, profile) => total + (Array.isArray(profile?.images) ? profile.images.length : 0), 0);
}
