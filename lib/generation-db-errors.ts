/** PostgREST / Supabase error when a table or object is missing from schema cache. */
export function isMissingDbObject(message: string, objectName: string): boolean {
  return (
    message.includes(objectName) &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("could not find"))
  );
}
