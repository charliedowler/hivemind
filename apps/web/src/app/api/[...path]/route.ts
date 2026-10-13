function notFound() {
  return Response.json({ error: "not_found" }, { status: 404 });
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE, notFound as HEAD, notFound as OPTIONS };
