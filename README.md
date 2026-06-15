# El-minimo-joder

## Objetivo
Construir un **segundo cerebro** que:

1. Esté sincronizado en la nube y no dependa de un único ordenador.
2. Permita crear y gestionar documentos/notas.
3. Incluya integración con Google Calendar.

## Requisitos funcionales mínimos (MVP)

### 1) Sincronización en la nube
- Los datos se guardan en almacenamiento remoto.
- El acceso a la información debe funcionar tras cambiar de dispositivo.
- La pérdida del ordenador local no implica pérdida de datos.

### 2) Creación de documentos
- Crear documentos/notas nuevas.
- Editar contenido existente.
- Listar y abrir documentos guardados.

### 3) Integración con Google Calendar
- Conectar cuenta de Google Calendar (OAuth).
- Ver próximos eventos desde la aplicación.
- Crear eventos en Google Calendar desde la aplicación.

## Criterios de aceptación
- Al iniciar sesión en un segundo dispositivo, aparecen los mismos documentos.
- Se puede crear una nota y recuperarla en otra sesión/dispositivo.
- Se puede consultar el calendario y crear al menos un evento nuevo.
