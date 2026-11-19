/** Share the navigation catalog between the service and the page without duplicating labels. */
export function navigationCatalogSource() {
  return {
    name: 'qgauss-navigation-catalog',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/common/navigation/navigation-catalog.json')) return null;
      return {code:'export default '+JSON.stringify(JSON.parse(source))+';',map:{mappings:''}};
    },
  };
}
