(function () {
    'use strict';

    var STORAGE_KEY = 'rxUiLanguage';
    var SUPPORTED = ['en', 'es'];
    var EXACT_ES = {
        'Active': 'Activo',
        'Add': 'Agregar',
        'Add New': 'Agregar nuevo',
        'Add Patient': 'Agregar paciente',
        'Advanced': 'Avanzado',
        'Administration': 'Administración',
        'Administrator Access Required': 'Se requiere acceso de administrador',
        'All': 'Todos',
        'All Current Settings': 'Todas las configuraciones actuales',
        'All Patients': 'Todos los pacientes',
        'All Pharmacies': 'Todas las farmacias',
        'All rights reserved': 'Todos los derechos reservados',
        'Analytics & Export': 'Análisis y exportación',
        'Answered': 'Contestada',
        'Application Name': 'Nombre de la aplicación',
        'Application Timezone': 'Zona horaria de la aplicación',
        'Arrival Date': 'Fecha de llegada',
        'Audit Log': 'Registro de auditoría',
        'Back': 'Atrás',
        'Back to login': 'Volver al inicio de sesión',
        'Backup Management': 'Administración de copias de seguridad',
        'Backups': 'Copias de seguridad',
        'Call Attempts': 'Intentos de llamada',
        'Call Center': 'Centro de llamadas',
        'Call Center Report': 'Informe del centro de llamadas',
        'Called': 'Llamado',
        'Cancel': 'Cancelar',
        'Change Password': 'Cambiar contraseña',
        'Changelog': 'Historial de cambios',
        'Clear': 'Limpiar',
        'Clear All': 'Limpiar todo',
        'Clinic': 'Clínica',
        'Clinics': 'Clínicas',
        'Close': 'Cerrar',
        'Company Patient': 'Paciente de la compañía',
        'Company Patients': 'Pacientes de la compañía',
        'Complete': 'Completar',
        'Completed': 'Completado',
        'Completed By': 'Completado por',
        'Completed Date': 'Fecha de finalización',
        'Confirm': 'Confirmar',
        'Connected': 'Conectada',
        'Current Completed Stage': 'Etapa actual completada',
        'Current Stage': 'Etapa actual',
        'Current Value': 'Valor actual',
        'Dashboard': 'Panel principal',
        'Data Import': 'Importación de datos',
        'Date': 'Fecha',
        'Date From': 'Fecha desde',
        'Date To': 'Fecha hasta',
        'Delete': 'Eliminar',
        'Delivery Management System': 'Sistema de gestión de entregas',
        'Dialing': 'Marcando',
        'Disabled': 'Deshabilitado',
        'DOB': 'Fecha de nacimiento',
        'Download': 'Descargar',
        'Edit': 'Editar',
        'Eligibility': 'Elegibilidad',
        'Eligible': 'Elegible',
        'Eligible Now': 'Elegible ahora',
        'Email Address': 'Correo electrónico',
        'Email Alert Conditions': 'Condiciones de alertas por correo',
        'Email Alerts': 'Alertas por correo',
        'Email Report': 'Enviar informe por correo',
        'Email Setup': 'Configuración de correo',
        'Enabled': 'Habilitado',
        'End Date': 'Fecha final',
        'Enter password': 'Ingrese la contraseña',
        'Enter username': 'Ingrese el usuario',
        'Error': 'Error',
        'Export': 'Exportar',
        'Export CSV': 'Exportar CSV',
        'Failed': 'Fallida',
        'First Name': 'Nombre',
        'General': 'General',
        'History': 'Historial',
        'History Includes Action': 'El historial incluye la acción',
        'Import': 'Importar',
        'Inactive': 'Inactivo',
        'Language': 'Idioma',
        'Last Name': 'Apellido',
        'Live RX Phones': 'Teléfonos RX en vivo',
        'Loading...': 'Cargando...',
        'Location / Clinic': 'Ubicación / clínica',
        'Log Out': 'Cerrar sesión',
        'Login': 'Inicio de sesión',
        'Logout': 'Cerrar sesión',
        'Manual': 'Manual',
        'Max Failed Logins': 'Máximo de intentos fallidos',
        'Medication': 'Medicamento',
        'Medications': 'Medicamentos',
        'Missing Info': 'Información faltante',
        'Name': 'Nombre',
        'New RX': 'Nuevo RX',
        'Next': 'Siguiente',
        'Next Action Required': 'Próxima acción requerida',
        'Next Pending Stage': 'Próxima etapa pendiente',
        'Next Service Date': 'Próxima fecha de servicio',
        'No': 'No',
        'No Answer': 'Sin respuesta',
        'No records found': 'No se encontraron registros',
        'Non-Company Patient': 'Paciente fuera de la compañía',
        'Non-Company Patients': 'Pacientes fuera de la compañía',
        'Not Returned': 'No devuelto',
        'Not Started': 'No iniciado',
        'Notes': 'Notas',
        'Patient': 'Paciente',
        'Patient Activity': 'Actividad del paciente',
        'Patient ID': 'ID del paciente',
        'Patient List': 'Lista de pacientes',
        'Patient Management': 'Administración de pacientes',
        'Patient Report': 'Informe de pacientes',
        'Patient Timeline': 'Cronología del paciente',
        'Patient Transport': 'Transporte de pacientes',
        'Patients': 'Pacientes',
        'Patients Management': 'Administración de pacientes',
        'Password': 'Contraseña',
        'Pharmacies': 'Farmacias',
        'Pharmacy': 'Farmacia',
        'Pharmacy Transport': 'Transporte de farmacia',
        'Phone': 'Teléfono',
        'Phone Account Setup': 'Configuración de cuenta telefónica',
        'Phone Devices': 'Dispositivos telefónicos',
        'Please try again.': 'Inténtelo nuevamente.',
        'Print': 'Imprimir',
        'Reference Data': 'Datos de referencia',
        'Refresh': 'Actualizar',
        'Reports': 'Informes',
        'Reset': 'Restablecer',
        'Returned to Warehouse': 'Devuelto al almacén',
        'Ringing': 'Sonando',
        'Role': 'Rol',
        'Roles': 'Roles',
        'Roles Management': 'Administración de roles',
        'RX Action Report': 'Informe de acciones RX',
        'RX Actions': 'Acciones RX',
        'RX Records': 'Registros RX',
        'Save': 'Guardar',
        'Save Changes': 'Guardar cambios',
        'Save Name': 'Guardar nombre',
        'Save Settings': 'Guardar configuración',
        'Save Timezone': 'Guardar zona horaria',
        'Saved!': '¡Guardado!',
        'Search': 'Buscar',
        'Search & Filter': 'Buscar y filtrar',
        'Security Settings': 'Configuración de seguridad',
        'Select': 'Seleccionar',
        'Select Language': 'Seleccionar idioma',
        'Service Date': 'Fecha de servicio',
        'Session Timeout': 'Tiempo de espera de sesión',
        'Settings': 'Configuración',
        'Show': 'Mostrar',
        'Show Patients': 'Mostrar pacientes',
        'Sign In': 'Iniciar sesión',
        'Start Date': 'Fecha inicial',
        'Status': 'Estado',
        'System Settings': 'Configuración del sistema',
        'Timeline': 'Cronología',
        'Two-Factor Authentication': 'Autenticación de dos factores',
        'Undo': 'Deshacer',
        'Unknown': 'Desconocido',
        'Update': 'Actualizar',
        'User Management': 'Administración de usuarios',
        'Username': 'Usuario',
        'Verify': 'Verificar',
        'View': 'Ver',
        'View Only': 'Solo lectura',
        'Warehouse Status': 'Estado del almacén',
        "Who's Online": 'Quién está conectado',
        'Workflow Actions': 'Acciones del flujo de trabajo',
        'Workflow Status': 'Estado del flujo de trabajo',
        'Yes': 'Sí'
    };

    // Second-pass coverage for regular application screens. Backoffice stays
    // excluded, and customer-entered names, notes, and reference data are not
    // included in this UI-only catalog.
    var SECOND_PASS_ES = {
        // Shared navigation, actions, states, and empty/loading messages.
        '-- None --': '-- Ninguno --',
        '-- Select --': '-- Seleccionar --',
        '-- Choose step --': '-- Elegir etapa --',
        'Access Denied': 'Acceso denegado',
        'Access Required': 'Acceso requerido',
        'Action': 'Acción',
        'Actions': 'Acciones',
        'Active Patient': 'Paciente activo',
        'Active Patients': 'Pacientes activos',
        'Add Action': 'Agregar acción',
        'Add First RX Record': 'Agregar primer registro RX',
        'Add Note': 'Agregar nota',
        'Add Record': 'Agregar registro',
        'All Clinics': 'Todas las clínicas',
        'All Patient Types': 'Todos los tipos de paciente',
        'All Patient Transports': 'Todos los transportes de pacientes',
        'All Pharmacy Transport': 'Todos los transportes de farmacia',
        'All Pharmacy Transports': 'Todos los transportes de farmacia',
        'All Transport Companies': 'Todas las compañías de transporte',
        'All Users': 'Todos los usuarios',
        'Apply': 'Aplicar',
        'Apply to Selected': 'Aplicar a los seleccionados',
        'Away': 'Ausente',
        'Back to Dashboard': 'Volver al panel principal',
        'Before': 'Antes',
        'Busy': 'Ocupado',
        'Card': 'Tarjetas',
        'Choose which columns to include:': 'Elija las columnas que desea incluir:',
        'Classic': 'Clásico',
        'Clear all filters': 'Limpiar todos los filtros',
        'Collapse All': 'Contraer todo',
        'Confirm Delete': 'Confirmar eliminación',
        'Confirm Import': 'Confirmar importación',
        'Copy': 'Copiar',
        'Create': 'Crear',
        'CSV': 'CSV',
        'Deleted': 'Eliminado',
        'Done': 'Listo',
        'Expand All': 'Expandir todo',
        'Export Excel': 'Exportar Excel',
        'Export PDF (print)': 'Exportar PDF (imprimir)',
        'First': 'Nombre',
        'Format / Details': 'Formato / detalles',
        'Full Name': 'Nombre completo',
        'In Progress': 'En curso',
        'Last': 'Apellido',
        'Loading': 'Cargando',
        'Menu': 'Menú',
        'Message': 'Mensaje',
        'Module': 'Módulo',
        'No access': 'Sin acceso',
        'No actions recorded.': 'No hay acciones registradas.',
        'No history recorded yet for this RX record.': 'Aún no hay historial para este registro RX.',
        'No patients found.': 'No se encontraron pacientes.',
        'No RX records found.': 'No se encontraron registros RX.',
        'No workflow steps defined.': 'No se definieron etapas del flujo de trabajo.',
        'None': 'Ninguno',
        'Online': 'En línea',
        'Other': 'Otro',
        'Page': 'Página',
        'Pending': 'Pendiente',
        'Previous': 'Anterior',
        'Prev': 'Anterior',
        'Reason:': 'Motivo:',
        'Record not found.': 'No se encontró el registro.',
        'Refresh now': 'Actualizar ahora',
        'Required': 'Obligatorio',
        'Restore': 'Restaurar',
        'Save date': 'Guardar fecha',
        'Search...': 'Buscar...',
        'Select all on this page': 'Seleccionar todos en esta página',
        'Show Deleted': 'Mostrar eliminados',
        'Show Disabled': 'Mostrar deshabilitados',
        'Show Hidden Records': 'Mostrar registros ocultos',
        'Source': 'Origen',
        'Step': 'Etapa',
        'Theme': 'Tema',
        'Time': 'Hora',
        'Unassigned': 'Sin asignar',
        'Unavailable': 'No disponible',
        'URL': 'URL',
        'Warning': 'Advertencia',

        // Call Center.
        'Answered and recorded automatically through RX Softphone': 'Contestada y registrada automáticamente mediante RX Softphone',
        'Answering': 'Contestando',
        'Another user': 'Otro usuario',
        'Call active': 'Llamada activa',
        'Call again': 'Llamar de nuevo',
        'Call Dates': 'Fechas de llamadas',
        'Call patient': 'Llamar al paciente',
        'Call Queue': 'Cola de llamadas',
        'Called today - waiting service date': 'Llamado hoy: esperando fecha de servicio',
        'Calls This Login': 'Llamadas en esta sesión',
        'Clinic / Location': 'Clínica / ubicación',
        'Creating a secure one-time code...': 'Creando un código seguro de un solo uso...',
        'Dates This Login': 'Fechas en esta sesión',
        'Efficiency': 'Eficiencia',
        'Expires in 10 minutes and can be used once.': 'Vence en 10 minutos y solo puede usarse una vez.',
        'Generate a code to begin.': 'Genere un código para comenzar.',
        'Generate new code': 'Generar código nuevo',
        'Generating': 'Generando',
        'Hang up this call': 'Finalizar esta llamada',
        'Incoming call': 'Llamada entrante',
        'Loading phone client': 'Cargando cliente telefónico',
        'Name, phone, clinic, or patient transport': 'Nombre, teléfono, clínica o transporte del paciente',
        'New Call Queue': 'Nueva cola de llamadas',
        'New Service Date': 'Nueva fecha de servicio',
        'No eligible patients found.': 'No se encontraron pacientes elegibles.',
        'Pair Windows phone': 'Vincular teléfono de Windows',
        'Pair Windows RX Softphone': 'Vincular RX Softphone de Windows',
        'Pairing code': 'Código de vinculación',
        'Patients Called This Login': 'Pacientes llamados en esta sesión',
        'Patients ready for the next call.': 'Pacientes listos para la próxima llamada.',
        'Patients This Login': 'Pacientes en esta sesión',
        'RX Softphone offline': 'RX Softphone sin conexión',
        'RX Softphone ready': 'RX Softphone listo',
        'Ready to call': 'Listo para llamar',
        'Service date entered': 'Fecha de servicio ingresada',
        'Service Dates Behind Efficiency': 'Fechas de servicio incluidas en la eficiencia',
        'Service Dates This Login': 'Fechas de servicio en esta sesión',
        'Trying': 'Intentando',
        'View calls': 'Ver llamadas',
        'View dates': 'Ver fechas',
        'View patients': 'Ver pacientes',
        'View queue': 'Ver cola',
        'You': 'Usted',

        // Dashboard and account security.
        '90-Day Service Eligibility': 'Elegibilidad de servicio de 90 días',
        'Activate 2FA': 'Activar 2FA',
        'Active patients only, inactive excluded': 'Solo pacientes activos; se excluyen los inactivos',
        'All Time': 'Todo el período',
        'All Users Combined': 'Todos los usuarios combinados',
        'Bar': 'Barras',
        'Call Center Activity': 'Actividad del centro de llamadas',
        'Call Center chart type': 'Tipo de gráfico del centro de llamadas',
        'Call Center history range': 'Período del historial del centro de llamadas',
        'Call Center Metrics': 'Métricas del centro de llamadas',
        'Call Center notes / calls': 'Notas / llamadas del centro de llamadas',
        'Call Center user': 'Usuario del centro de llamadas',
        'Call checkbox saved in range': 'Casilla de llamada guardada en el período',
        'Calls': 'Llamadas',
        'Calls / Date': 'Llamadas / fecha',
        'Calls / service dates': 'Llamadas / fechas de servicio',
        'Calls minus unique patients': 'Llamadas menos pacientes únicos',
        'Change Password & Sign Out Other Sessions': 'Cambiar contraseña y cerrar otras sesiones',
        'Click to view eligible patients': 'Haga clic para ver pacientes elegibles',
        'Click to view list': 'Haga clic para ver la lista',
        'Click to view patients expiring within 7 days': 'Haga clic para ver pacientes que vencen en 7 días',
        'Click to view patients in active window': 'Haga clic para ver pacientes en la ventana activa',
        'Click to view patients with no service date': 'Haga clic para ver pacientes sin fecha de servicio',
        'Conversion': 'Conversión',
        'Copy All Codes': 'Copiar todos los códigos',
        'Current password': 'Contraseña actual',
        'Dashboard Card Totals': 'Totales de tarjetas del panel',
        'Date Range:': 'Intervalo de fechas:',
        'Dates': 'Fechas',
        'Disable Two-Factor Authentication': 'Desactivar autenticación de dos factores',
        'Efficiency History': 'Historial de eficiencia',
        'Eligibility Over Time': 'Elegibilidad a lo largo del tiempo',
        'Eligible queue patients now': 'Pacientes elegibles actualmente en la cola',
        'Enter authenticator code to confirm': 'Ingrese el código del autenticador para confirmar',
        'Enter the 6-digit code to confirm setup': 'Ingrese el código de 6 dígitos para confirmar la configuración',
        'In Active Window': 'En ventana activa',
        'Inactive Patients': 'Pacientes inactivos',
        'Last 30 days': 'Últimos 30 días',
        'Last 30 Days': 'Últimos 30 días',
        'Last Activity': 'Última actividad',
        'Latest call, note, or date': 'Última llamada, nota o fecha',
        'Line': 'Líneas',
        'Loading Call Queue cutoff...': 'Cargando límite de la cola de llamadas...',
        'Loading Call Queue cutoff…': 'Cargando límite de la cola de llamadas…',
        'Manual entry key': 'Clave de entrada manual',
        'My Account': 'Mi cuenta',
        'My Account / 2FA': 'Mi cuenta / 2FA',
        'My Account Security': 'Seguridad de mi cuenta',
        'New password (min 8 chars)': 'Contraseña nueva (mínimo 8 caracteres)',
        'New service dates entered': 'Nuevas fechas de servicio ingresadas',
        'No Service Date': 'Sin fecha de servicio',
        'Notes / Call': 'Notas / llamada',
        'Off': 'Desactivado',
        'Overall Completion': 'Finalización general',
        'Patients Called': 'Pacientes llamados',
        'Patients Over Time': 'Pacientes a lo largo del tiempo',
        'Pending Deliveries': 'Entregas pendientes',
        'Regenerate': 'Regenerar',
        'Repeat': 'Repetición',
        'Repeat Calls': 'Llamadas repetidas',
        'Repeat calls / total calls': 'Llamadas repetidas / llamadas totales',
        'Repeat Rate': 'Tasa de repetición',
        'Report': 'Informe',
        'RX Records Status': 'Estado de registros RX',
        'RX Workflow Pipeline': 'Flujo de trabajo RX',
        'Scope: All Users': 'Alcance: todos los usuarios',
        'Service Date Entries': 'Registros de fecha de servicio',
        'Service Dates': 'Fechas de servicio',
        'Service dates / calls': 'Fechas de servicio / llamadas',
        'Service dates / patients': 'Fechas de servicio / pacientes',
        'Set Up Two-Factor Authentication': 'Configurar autenticación de dos factores',
        'Showing all time': 'Mostrando todo el período',
        'This Month': 'Este mes',
        'This Week': 'Esta semana',
        'This Year': 'Este año',
        'Timeline Range': 'Período de la cronología',
        'Today': 'Hoy',
        'Total No-RX Records': 'Total sin registros RX',
        'Total RX Records': 'Total de registros RX',
        'Trend chart type': 'Tipo de gráfico de tendencias',
        'Trend range': 'Período de tendencias',
        'Unique patients with calls': 'Pacientes únicos con llamadas',
        'Uses the same range': 'Usa el mismo período',
        'View eligible patients': 'Ver pacientes elegibles',
        'View list': 'Ver lista',
        'View Patients': 'Ver pacientes',
        'View patients behind Calls': 'Ver pacientes incluidos en llamadas',
        'View patients behind Calls per Date': 'Ver pacientes incluidos en llamadas por fecha',
        'View patients behind Conversion': 'Ver pacientes incluidos en conversión',
        'View patients behind Efficiency': 'Ver pacientes incluidos en eficiencia',
        'View patients behind Last Activity': 'Ver pacientes incluidos en última actividad',
        'View patients behind Notes per Call': 'Ver pacientes incluidos en notas por llamada',
        'View patients behind Patients Called': 'Ver pacientes incluidos en pacientes llamados',
        'View patients behind Repeat Calls': 'Ver pacientes incluidos en llamadas repetidas',
        'View patients behind Repeat Rate': 'Ver pacientes incluidos en tasa de repetición',
        'View patients behind Service Dates': 'Ver pacientes incluidos en fechas de servicio',
        'View RX Records': 'Ver registros RX',
        'Workflow Completion': 'Finalización del flujo de trabajo',
        'Workflow Over Time': 'Flujo de trabajo a lo largo del tiempo',

        // Patients and patient timeline.
        '(Optional - Will auto-generate if blank)': '(Opcional; se generará automáticamente si se deja en blanco)',
        'Address': 'Dirección',
        'Any Information Status': 'Cualquier estado de información',
        'Are you sure you want to delete this patient?': '¿Está seguro de que desea eliminar este paciente?',
        'Back to Patients': 'Volver a pacientes',
        'Captured Defaults': 'Valores predeterminados capturados',
        'Changed By': 'Modificado por',
        'Changed by:': 'Modificado por:',
        'Date / User': 'Fecha / usuario',
        'Date of Birth': 'Fecha de nacimiento',
        'Default Pharmacy': 'Farmacia predeterminada',
        'Export History CSV': 'Exportar historial CSV',
        'Export Patients Select Columns': 'Exportar pacientes: seleccionar columnas',
        'Export related RX CSV for this service date': 'Exportar CSV de RX relacionados con esta fecha de servicio',
        'Export the full service date history CSV': 'Exportar CSV del historial completo de fechas de servicio',
        'First name': 'Nombre',
        'First or last name...': 'Nombre o apellido...',
        'Generated:': 'Generado:',
        'Invalid patient ID.': 'ID de paciente no válido.',
        'Last name': 'Apellido',
        'Loading history...': 'Cargando historial...',
        'Loading notes...': 'Cargando notas...',
        'Loading patient timeline...': 'Cargando cronología del paciente...',
        'Locked — active -day window': 'Bloqueado: ventana activa de días',
        'Medications:': 'Medicamentos:',
        'Missing Any Required Default': 'Falta algún valor predeterminado obligatorio',
        'Missing Clinic': 'Falta clínica',
        'Missing Clinic, Pharmacy & Transports': 'Faltan clínica, farmacia y transportes',
        'Missing Patient Transport': 'Falta transporte del paciente',
        'Missing Pharmacy': 'Falta farmacia',
        'Missing Pharmacy Transport': 'Falta transporte de farmacia',
        'New': 'Nuevo',
        'Next Svc Date': 'Próxima fecha de servicio',
        'No clinic/pharmacy/transport snapshot captured for this cycle yet.': 'Aún no se ha capturado una referencia de clínica, farmacia o transporte para este ciclo.',
        'No medications recorded': 'No hay medicamentos registrados',
        'No RX Records Found': 'No se encontraron registros RX',
        'Only records matching your current search & filters will be exported.': 'Solo se exportarán los registros que coincidan con la búsqueda y los filtros actuales.',
        'Open in RX Records': 'Abrir en Registros RX',
        'Patient Code:': 'Código del paciente:',
        'Patient ID:': 'ID del paciente:',
        'Patient Notes': 'Notas del paciente',
        'Patient Record Print Preview': 'Vista previa de impresión del paciente',
        'Patient Service Date History': 'Historial de fechas de servicio del paciente',
        'Patient Transport Contact Person': 'Persona de contacto del transporte del paciente',
        'Patient Type': 'Tipo de paciente',
        'Patient:': 'Paciente:',
        'Pharmacy Transport Contact Person': 'Persona de contacto del transporte de farmacia',
        'Please type': 'Escriba',
        'Print All': 'Imprimir todo',
        'Print Full History': 'Imprimir historial completo',
        'Print related RX for this service date': 'Imprimir RX relacionados con esta fecha de servicio',
        'Print RX': 'Imprimir RX',
        'Print the full service date history section': 'Imprimir la sección completa del historial de fechas de servicio',
        'Print Timeline': 'Imprimir cronología',
        'Related RX': 'RX relacionados',
        'removed': 'eliminado',
        'RX History — Previous Service Dates': 'Historial RX: fechas de servicio anteriores',
        'RX Record History': 'Historial del registro RX',
        'RX Transport': 'Transporte RX',
        'Save & Add RX': 'Guardar y agregar RX',
        'Service date change:': 'Cambio de fecha de servicio:',
        'Service Date From': 'Fecha de servicio desde',
        'Service Date History': 'Historial de fechas de servicio',
        'Service Date RX Records': 'Registros RX de la fecha de servicio',
        'Service Date To': 'Fecha de servicio hasta',
        'Source:': 'Origen:',
        'Svc Dates': 'Fechas de servicio',
        'This patient has no RX records yet.': 'Este paciente aún no tiene registros RX.',
        'Total RX': 'Total de RX',
        'Type a note... (phone call, instructions, follow-up, etc.)': 'Escriba una nota... (llamada, instrucciones, seguimiento, etc.)',
        'View in RX Records': 'Ver en Registros RX',
        'When': 'Cuándo',
        'Workflow Progress': 'Progreso del flujo de trabajo',

        // RX Records and workflow dialogs.
        '(already done)': '(ya completado)',
        '90-Day Window Expired': 'La ventana de 90 días venció',
        'Active records will be skipped and reported in the result summary.': 'Los registros activos se omitirán y aparecerán en el resumen de resultados.',
        'After': 'Después',
        'All Current Stages': 'Todas las etapas actuales',
        'All Next Actions': 'Todas las próximas acciones',
        'All Warehouse Statuses': 'Todos los estados de almacén',
        'All Workflow': 'Todos los flujos de trabajo',
        'Apply Workflow Step:': 'Aplicar etapa del flujo de trabajo:',
        'Bulk Workflow Results': 'Resultados del flujo de trabajo masivo',
        'Clears all workflow steps & marks as returned': 'Borra todas las etapas del flujo y marca como devuelto',
        'Close Expired': 'Cerrar vencidos',
        'Close Expired RX Records': 'Cerrar registros RX vencidos',
        'Close RX Record': 'Cerrar registro RX',
        'Cycle Status': 'Estado del ciclo',
        'Cycle Status:': 'Estado del ciclo:',
        'Date Completed': 'Fecha de finalización',
        'Days Lag': 'Días de retraso',
        'Error loading history.': 'Error al cargar el historial.',
        'Error loading record.': 'Error al cargar el registro.',
        'Error loading workflow.': 'Error al cargar el flujo de trabajo.',
        'Expired': 'Vencido',
        'Failed to load history.': 'No se pudo cargar el historial.',
        'Failed to load record.': 'No se pudo cargar el registro.',
        'Field': 'Campo',
        'Fields below are auto-filled from the patient record': 'Los campos siguientes se completan automáticamente con el registro del paciente',
        'Global 90-Day Override Active': 'Excepción global de 90 días activa',
        'Loading patients...': 'Cargando pacientes...',
        'Loading record...': 'Cargando registro...',
        'Loading RX records...': 'Cargando registros RX...',
        'New RX Record': 'Nuevo registro RX',
        'Next Service Date:': 'Próxima fecha de servicio:',
        'Notes:': 'Notas:',
        'Open Print Preview': 'Abrir vista previa de impresión',
        'Overall Progress': 'Progreso general',
        'Override Only — you can resolve expired RX workflow locks and update old-cycle workflow dates.': 'Solo excepción: puede resolver bloqueos vencidos del flujo RX y actualizar fechas de ciclos anteriores.',
        'Patient Name': 'Nombre del paciente',
        'Please request access for this transaction to your administrator.': 'Solicite a su administrador acceso para esta operación.',
        'Progress:': 'Progreso:',
        'Reason / note (optional)': 'Motivo / nota (opcional)',
        'Request Access': 'Solicitar acceso',
        'Return to Warehouse': 'Devolver al almacén',
        'RX #': 'RX n.º',
        'RX number': 'Número RX',
        'RX Record': 'Registro RX',
        'RX Record Details': 'Detalles del registro RX',
        'RX Record Print Preview': 'Vista previa de impresión del registro RX',
        'RX Workflow Tracking': 'Seguimiento del flujo RX',
        'Save RX': 'Guardar RX',
        'Search by name, last name or ID...': 'Buscar por nombre, apellido o ID...',
        'Service Date:': 'Fecha de servicio:',
        'Service From': 'Servicio desde',
        'Service To': 'Servicio hasta',
        'This RX record is past the 90-day window and old-cycle edits require override access.': 'Este registro RX superó la ventana de 90 días y los cambios del ciclo anterior requieren acceso de excepción.',
        'To change these values, edit the patient record first.': 'Para cambiar estos valores, edite primero el registro del paciente.',
        'Type YES to confirm': 'Escriba SÍ para confirmar',
        'Use this when the cycle is complete and a new service date should begin a new RX record.': 'Use esta opción cuando el ciclo termine y una nueva fecha de servicio deba iniciar otro registro RX.',
        'View Only — you do not have permission to update workflow steps.': 'Solo lectura: no tiene permiso para actualizar las etapas del flujo de trabajo.',
        'Workflow Checklist': 'Lista de verificación del flujo de trabajo',
        'Workflow Steps': 'Etapas del flujo de trabajo',
        'YES': 'SÍ',
        'Yes, Close Selected': 'Sí, cerrar seleccionados',

        // Reports and export filters.
        'Activity From': 'Actividad desde',
        'Activity To': 'Actividad hasta',
        'Activity Type': 'Tipo de actividad',
        'Agent': 'Agente',
        'Agent / Extension': 'Agente / extensión',
        'All Activity': 'Toda la actividad',
        'All Completeness': 'Cualquier nivel de integridad',
        'All Eligibility': 'Cualquier elegibilidad',
        'All Outcomes': 'Todos los resultados',
        'All Workflow Statuses': 'Todos los estados del flujo de trabajo',
        'Answer Rate': 'Tasa de respuesta',
        'Any Action in History': 'Cualquier acción en el historial',
        'Arrival From': 'Llegada desde',
        'Arrival To': 'Llegada hasta',
        'Attempts': 'Intentos',
        'Automatic Call Attempts': 'Intentos automáticos de llamada',
        'Avg Ring': 'Promedio de timbrado',
        'Avg Talk': 'Promedio de conversación',
        'Call Center Filters': 'Filtros del centro de llamadas',
        'Call Outcome': 'Resultado de la llamada',
        'Call Pre-Eligibility': 'Pre-elegibilidad de llamadas',
        'Calls by Agent': 'Llamadas por agente',
        'Calls by Clinic': 'Llamadas por clínica',
        'Calls by Date': 'Llamadas por fecha',
        'Cancelled': 'Cancelada',
        'Clinic...': 'Clínica...',
        'Complete History CSV': 'CSV del historial completo',
        'Conversation': 'Conversación',
        'Current Stage Date': 'Fecha de la etapa actual',
        'Daily Summary (stats overview)': 'Resumen diario (estadísticas generales)',
        'Date From (optional)': 'Fecha desde (opcional)',
        'Date To (optional)': 'Fecha hasta (opcional)',
        'Dialed': 'Marcada',
        'Dialed Number': 'Número marcado',
        'Email this report': 'Enviar este informe por correo',
        'Ended': 'Finalizada',
        'Excel': 'Excel',
        'Extension': 'Extensión',
        'Extension...': 'Extensión...',
        'First name...': 'Nombre...',
        'First...': 'Nombre...',
        'Has RX Records': 'Tiene registros RX',
        'History / Notes': 'Historial / notas',
        'Last name...': 'Apellido...',
        'Last...': 'Apellido...',
        'Leave blank for auto subject': 'Deje en blanco para generar el asunto automáticamente',
        'Missing All Assignments': 'Faltan todas las asignaciones',
        'Missing Any Assignment': 'Falta alguna asignación',
        'Missing Information': 'Falta información',
        'Needs Workflow Action': 'Requiere acción del flujo de trabajo',
        'No RX Records': 'Sin registros RX',
        'No-Answer Rate': 'Tasa sin respuesta',
        'One row per patient with Called, repeat-call, service-date, and note totals.': 'Una fila por paciente con totales de llamadas, repeticiones, fechas de servicio y notas.',
        'Open — Not Completed': 'Abierto: no completado',
        'Outcome': 'Resultado',
        'Patient Activity Summary': 'Resumen de actividad del paciente',
        'Patient Filters': 'Filtros de pacientes',
        'Patient First Name': 'Nombre del paciente',
        'Patient Last Name': 'Apellido del paciente',
        'Patient Status': 'Estado del paciente',
        'PDF': 'PDF',
        'Recipient Email': 'Correo del destinatario',
        'Rejected': 'Rechazada',
        'Report Type': 'Tipo de informe',
        'Ring': 'Timbrado',
        'RX Filters': 'Filtros RX',
        'RX number...': 'Número RX...',
        'Send Report': 'Enviar informe',
        'Send Report by Email': 'Enviar informe por correo',
        'Separate multiple addresses with a comma.': 'Separe varias direcciones con una coma.',
        'SIP Response': 'Respuesta SIP',
        'Stage Activity From': 'Actividad de etapa desde',
        'Stage Activity To': 'Actividad de etapa hasta',
        'Stage History': 'Historial de etapas',
        'Subject (optional)': 'Asunto (opcional)',
        'Summary Excel': 'Resumen Excel',
        'Supervisor Call Summary': 'Resumen de llamadas del supervisor',
        'Supervisor Summary': 'Resumen del supervisor',
        'Svc Date': 'Fecha de servicio',
        'Talk': 'Conversación',
        'Total Talk': 'Conversación total',
        'Unanswered': 'No contestada',
        'Users': 'Usuarios',
        'Warehouse': 'Almacén',
        'With or Without RX': 'Con o sin RX',
        'Workflow': 'Flujo de trabajo',

        // Branding and transportation icon picker.
        'Accessible Transport': 'Transporte accesible',
        'Admin Only': 'Solo administradores',
        'Boarding a Minivan': 'Abordando una minivan',
        'Browser Application Name': 'Nombre de la aplicación en el navegador',
        'Car Service': 'Servicio de automóvil',
        'Community Shuttle': 'Transporte comunitario',
        'Current server time in selected zone:': 'Hora actual del servidor en la zona seleccionada:',
        'Current UTC time:': 'Hora UTC actual:',
        'Custom Icon Path (optional)': 'Ruta de icono personalizado (opcional)',
        'Fallback Icon Class': 'Clase del icono alternativo',
        'Login and Sidebar Branding': 'Marca del inicio de sesión y menú lateral',
        'Login and Sidebar Title': 'Título del inicio de sesión y menú lateral',
        'Login Background Path (optional)': 'Ruta del fondo de inicio de sesión (opcional)',
        'Login Subtitle': 'Subtítulo del inicio de sesión',
        'Medical Transport': 'Transporte médico',
        'Minivan / Shuttle': 'Minivan / transporte',
        'Passenger Van': 'Van de pasajeros',
        'People Riding in Minivan': 'Personas viajando en minivan',
        'Save Branding': 'Guardar marca',
        'Save 2FA Setting': 'Guardar configuración de 2FA',
        'Save Security Settings': 'Guardar configuración de seguridad',
        'Select Timezone': 'Seleccionar zona horaria',
        'Server Current Time': 'Hora actual del servidor',
        'Setting Key': 'Clave de configuración',
        'Taxi': 'Taxi',
        'Transportation and Service Icons': 'Iconos de transporte y servicio',
        'UTC offset:': 'Diferencia UTC:',
        'Use Defaults': 'Usar valores predeterminados',

        // Import, audit, live-phone, and active-session screens.
        'All statuses': 'Todos los estados',
        'Auto-refresh': 'Actualización automática',
        'Audit Entries': 'Entradas de auditoría',
        'Backend': 'Servidor',
        'Browser': 'Navegador',
        'Browser / Agent': 'Navegador / agente',
        'Change Audit': 'Auditoría de cambios',
        'Change Details': 'Detalles del cambio',
        'Clear Resolved': 'Limpiar resueltos',
        'Clear Selection': 'Limpiar selección',
        'Column Name': 'Nombre de columna',
        'Could not load active sessions': 'No se pudieron cargar las sesiones activas',
        'CSV Column Specifications:': 'Especificaciones de columnas CSV:',
        'Data / Changes': 'Datos / cambios',
        'Data Import Center': 'Centro de importación de datos',
        'Date & Time': 'Fecha y hora',
        'Delete Selected': 'Eliminar seleccionados',
        'Download CSV Template': 'Descargar plantilla CSV',
        'Drag and drop or click to browse files': 'Arrastre y suelte o haga clic para buscar archivos',
        'Error Log': 'Registro de errores',
        'Frontend': 'Interfaz',
        'HTTP status quick guide': 'Guía rápida de estados HTTP',
        'Idle': 'Inactivo',
        'Import Completed': 'Importación completada',
        'Import Datasets': 'Importar conjuntos de datos',
        'Import Logs & Warnings:': 'Registros y advertencias de importación:',
        'In Call': 'En llamada',
        'IP Address': 'Dirección IP',
        'Issues': 'Problemas',
        'Loading active sessions…': 'Cargando sesiones activas…',
        'Loading RX Softphone lines...': 'Cargando líneas de RX Softphone...',
        'Manage devices': 'Administrar dispositivos',
        'No active sessions right now': 'No hay sesiones activas en este momento',
        'Offline': 'Sin conexión',
        'Offline / Issue': 'Sin conexión / problema',
        'Open Only': 'Solo abiertos',
        'Page Activity': 'Actividad de páginas',
        'Page Activity Filters': 'Filtros de actividad de páginas',
        'Path': 'Ruta',
        'Patients Import': 'Importación de pacientes',
        'Preview & Validate': 'Previsualizar y validar',
        'Record / Patient': 'Registro / paciente',
        'Referrer': 'Referente',
        'Registered': 'Registrado',
        'Resolve Selected': 'Resolver seleccionados',
        'Resolved Only': 'Solo resueltos',
        'Rotate Logs': 'Rotar registros',
        'Row Errors:': 'Errores de filas:',
        'RX Softphone presence board': 'Panel de presencia de RX Softphone',
        'Select a CSV File': 'Seleccione un archivo CSV',
        'Severity': 'Gravedad',
        'User phone lines': 'Líneas telefónicas de usuarios',
        'User, patient, extension, or computer': 'Usuario, paciente, extensión o computadora',
        'Users will appear here as they log in and use the system.': 'Los usuarios aparecerán aquí cuando inicien sesión y usen el sistema.',
        'Validation Preview': 'Vista previa de validación',
        'Your role needs Data Import visibility plus Add or Edit permission to import datasets.': 'Su rol necesita acceso a Importación de datos y permiso para agregar o editar conjuntos de datos.',
        'Help & User Manual': 'Ayuda y manual del usuario',
        'Full Manual': 'Manual completo',
        'Reports & Selective Filters': 'Informes y filtros selectivos',
        'System Settings — General': 'Configuración del sistema: General',
        'System Settings — Email Setup': 'Configuración del sistema: correo',
        'System Settings — API Keys': 'Configuración del sistema: claves API',
        'Multi-User / Concurrent Access': 'Acceso multiusuario / simultáneo',
        'Workflow Actions (Steps)': 'Acciones del flujo de trabajo (etapas)',

        // The remainder is extended below by page group.
        '__SECOND_PASS_SENTINEL__': '__SECOND_PASS_SENTINEL__'
    };

    Object.keys(SECOND_PASS_ES).forEach(function (key) {
        if (key !== '__SECOND_PASS_SENTINEL__') EXACT_ES[key] = SECOND_PASS_ES[key];
    });

    var PHRASE_ES = {
        'Please enter both username and password.': 'Ingrese el usuario y la contraseña.',
        'Invalid username or password.': 'El usuario o la contraseña no son válidos.',
        'Could not connect to the server. Please try again.': 'No se pudo conectar con el servidor. Inténtelo nuevamente.',
        'Enter the 6-digit code from your authenticator app': 'Ingrese el código de 6 dígitos de su aplicación de autenticación',
        'Please enter the full 6-digit code.': 'Ingrese el código completo de 6 dígitos.',
        'Invalid code. Please try again.': 'Código no válido. Inténtelo nuevamente.',
        'Network error. Please try again.': 'Error de red. Inténtelo nuevamente.',
        'You were logged out due to inactivity.': 'Su sesión se cerró por inactividad.',
        'Password changed successfully. Please log in with your new password.': 'La contraseña se cambió correctamente. Inicie sesión con su nueva contraseña.',
        'Only Administrators can manage system settings.': 'Solo los administradores pueden gestionar la configuración del sistema.',
        'Configure system-wide preferences. Changes take effect immediately.': 'Configure las preferencias generales del sistema. Los cambios se aplican inmediatamente.',
        'No records found.': 'No se encontraron registros.',
        'Are you sure?': '¿Está seguro?',
        'Changes saved successfully.': 'Los cambios se guardaron correctamente.',
        'Call records from this login, grouped by patient. Repeat calls appear in Call Dates.': 'Registros de llamadas de esta sesión agrupados por paciente. Las llamadas repetidas aparecen en Fechas de llamadas.',
        'Unique patients called during this login.': 'Pacientes únicos llamados durante esta sesión.',
        'Patients where a new service date was entered during this login.': 'Pacientes a quienes se agregó una nueva fecha de servicio durante esta sesión.',
        'Patients with service dates entered during this login. Efficiency is service dates divided by calls.': 'Pacientes con fechas de servicio ingresadas durante esta sesión. La eficiencia es el número de fechas de servicio dividido entre las llamadas.',
        'The green phone opens MicroSIP with the number. MicroSIP must show Online before it can place the call. After the call, mark Called and Save.': 'El teléfono verde abre MicroSIP con el número. MicroSIP debe indicar En línea antes de realizar la llamada. Después, marque Llamado y guarde.',
        'Calls open in MicroSIP. After the call, mark Called and Save.': 'Las llamadas se abren en MicroSIP. Después de la llamada, marque Llamado y guarde.',
        'The relay carries commands and call status only. SIP and audio remain on the Windows PC.': 'El enlace transmite solamente comandos y el estado de la llamada. SIP y el audio permanecen en la computadora con Windows.',
        'Open RX Softphone 0.4.1 or later on the Windows PC that will handle calls. Enter the RX Tracker server address and this one-time code:': 'Abra RX Softphone 0.4.1 o posterior en la computadora con Windows que atenderá las llamadas. Ingrese la dirección del servidor RX Tracker y este código de un solo uso:',
        'RX Softphone is not registered, so calls will open in MicroSIP.': 'RX Softphone no está registrado, por lo que las llamadas se abrirán en MicroSIP.',
        'Open RX Softphone and register it to the PBX before calling.': 'Abra RX Softphone y regístrelo en la central PBX antes de llamar.',
        'RX Softphone must run on the same computer as this browser. Remote browsers such as Kasm cannot use a softphone running on your Windows PC.': 'RX Softphone debe ejecutarse en la misma computadora que este navegador. Los navegadores remotos, como Kasm, no pueden usar un softphone que se ejecute en su computadora con Windows.',
        'RX Softphone records attempts and answered calls automatically. Save is only for a note or new service date.': 'RX Softphone registra automáticamente los intentos y las llamadas contestadas. Guardar se usa solamente para una nota o una nueva fecha de servicio.',
        'Could not generate a pairing code.': 'No se pudo generar un código de vinculación.',
        'Select Called, add a note, or enter a new service date.': 'Seleccione Llamado, agregue una nota o ingrese una nueva fecha de servicio.',
        'One or more patients were claimed by another user. Refreshing queue.': 'Otro usuario tomó uno o más pacientes. Se está actualizando la cola.',
        'Could not claim patient. Please retry.': 'No se pudo tomar el paciente. Inténtelo nuevamente.',
        'Could not claim patient. Try refreshing.': 'No se pudo tomar el paciente. Intente actualizar la página.',
        'Are you sure you want to delete this record? This action cannot be undone.': '¿Está seguro de que desea eliminar este registro? Esta acción no se puede deshacer.',
        'Password changed. Other sessions have been signed out.': 'La contraseña cambió. Las demás sesiones se cerraron.',
        'Save these backup codes now.': 'Guarde ahora estos códigos de respaldo.',
        'They will not be shown again. Use one if you lose access to your authenticator app.': 'No volverán a mostrarse. Use uno si pierde acceso a su aplicación de autenticación.',
        'Lost your backup codes? Generate a new set (invalidates old codes).': '¿Perdió sus códigos de respaldo? Genere un conjunto nuevo; los anteriores dejarán de ser válidos.',
        'This field is always blank. Type a new password only if you want to replace the saved one.': 'Este campo siempre aparece vacío. Escriba una contraseña nueva únicamente si desea reemplazar la guardada.',
        'No active sessions right now': 'No hay sesiones activas en este momento',
        'FortiGate did not load the Live RX Phones script. Hard-refresh this page or start a new SSL-VPN portal session.': 'FortiGate no cargó el módulo de Teléfonos RX en vivo. Fuerce la actualización de esta página o inicie una nueva sesión del portal SSL-VPN.',
        'All dates and times recorded by the system — workflow steps, audit logs, and patient records — will use this timezone.': 'Todas las fechas y horas registradas por el sistema —etapas del flujo, auditorías y registros de pacientes— usarán esta zona horaria.',
        'Customize the application title, login subtitle, icon, and login background. Icon and background URLs must be same-site paths to files placed under the public folder.': 'Personalice el título de la aplicación, el subtítulo, el icono y el fondo de inicio de sesión. Las rutas del icono y del fondo deben pertenecer a este sitio y apuntar a archivos de la carpeta pública.',
        'Use a bundled Font Awesome class, for example': 'Use una clase Font Awesome incluida, por ejemplo',
        'Choose a preset or enter a different bundled Font Awesome class below. Custom icon paths still override the fallback class.': 'Elija un icono predeterminado o escriba otra clase Font Awesome incluida. La ruta de un icono personalizado tiene prioridad.',
        'Leave blank to use the fallback icon class.': 'Déjelo en blanco para usar la clase del icono alternativo.',
        'Leave blank to use the standard gradient.': 'Déjelo en blanco para usar el degradado estándar.',
        'Global Two-Factor Authentication (2FA)': 'Autenticación global de dos factores (2FA)',
        'Controls whether 2FA is enforced system-wide at login. When': 'Controla si la autenticación 2FA es obligatoria al iniciar sesión. Cuando está',
        'Users with 2FA set up will be prompted for their code': 'A los usuarios con 2FA se les solicitará su código',
        'Control how long idle sessions remain active and how many failed login attempts are allowed before an account is locked.': 'Controla cuánto tiempo permanecen activas las sesiones inactivas y cuántos intentos fallidos se permiten antes de bloquear una cuenta.',
        'Click any question to expand the answer': 'Haga clic en cualquier pregunta para ampliar la respuesta',
        'Patient RX Delivery System — complete feature guide': 'Sistema de entregas Patient RX: guía completa de funciones'
    };

    function translateDynamic(value) {
        var match;
        if ((match = value.match(/^Calling from day (\d+)\s*[·•]\s*Service eligible day (\d+)$/))) {
            return 'Llamadas desde el día ' + match[1] + ' · Servicio elegible el día ' + match[2];
        }
        if ((match = value.match(/^Page (\d+) of (\d+)$/))) {
            return 'Página ' + match[1] + ' de ' + match[2];
        }
        if ((match = value.match(/^(\d+)-(\d+) of (\d+)$/))) {
            return match[1] + '-' + match[2] + ' de ' + match[3];
        }
        if ((match = value.match(/^(.+?) \/ (\d+) (calls|patients|dates)$/))) {
            var activityLabels = { calls: 'llamadas', patients: 'pacientes', dates: 'fechas' };
            return match[1] + ' / ' + match[2] + ' ' + activityLabels[match[3]];
        }
        if ((match = value.match(/^\+(\d+) more$/))) {
            return '+' + match[1] + ' más';
        }
        if ((match = value.match(/^Hello, (.+)$/))) {
            return 'Hola, ' + match[1];
        }
        if ((match = value.match(/^Connected for (.+)$/))) {
            return 'Conectada durante ' + match[1];
        }
        if ((match = value.match(/^Cooldown: (.+)$/))) {
            return 'Espera: ' + match[1];
        }
        if ((match = value.match(/^In use by (.+)$/))) {
            return 'En uso por ' + match[1]
                .replace(/\bDialing\b/g, 'Marcando')
                .replace(/\bTrying\b/g, 'Intentando')
                .replace(/\bRinging\b/g, 'Sonando')
                .replace(/\bAnswering\b/g, 'Contestando')
                .replace(/\bConnected\b/g, 'Conectada')
                .replace(/\bIncoming call\b/g, 'Llamada entrante');
        }
        if ((match = value.match(/^Call (.+) with (.+)$/))) {
            return 'Llamar al ' + match[1] + ' con ' + match[2];
        }
        if ((match = value.match(/^Calling (.+) with RX Softphone(?: through the Windows relay\.)?$/))) {
            return 'Llamando al ' + match[1] + ' con RX Softphone';
        }
        if ((match = value.match(/^(\d+) records selected$/))) {
            return match[1] + ' registros seleccionados';
        }
        if ((match = value.match(/^(\d+) filters?$/))) {
            return match[1] + (match[1] === '1' ? ' filtro' : ' filtros');
        }
        if ((match = value.match(/^Showing (.+) of (.+) records$/))) {
            return 'Mostrando ' + match[1] + ' de ' + match[2] + ' registros';
        }
        if ((match = value.match(/^(.+) - Patient RX System$/))) {
            return (EXACT_ES[match[1]] || PHRASE_ES[match[1]] || match[1]) + ' - Patient RX System';
        }
        return value;
    }

    function normalizeLanguage(value) {
        var lang = String(value || '').toLowerCase().split('-')[0];
        return SUPPORTED.indexOf(lang) >= 0 ? lang : 'en';
    }

    function getLanguage() {
        return normalizeLanguage(localStorage.getItem(STORAGE_KEY) || 'en');
    }

    function translateString(value) {
        if (getLanguage() !== 'es') return value;
        var raw = String(value == null ? '' : value);
        var trimmed = raw.trim();
        if (!trimmed) return raw;
        var translated = EXACT_ES[trimmed] || PHRASE_ES[trimmed] || translateDynamic(trimmed);
        if (translated === trimmed) return raw;
        return raw.replace(trimmed, translated);
    }

    function isProtectedDataNode(node) {
        var parent = node && node.parentElement;
        if (!parent) return true;
        if (parent.closest('[data-i18n-skip], script, style, code, pre, textarea')) return true;
        var td = parent.closest('tbody td');
        if (td && !parent.closest('.badge, .btn, button, .alert, [data-i18n-ui]')) return true;
        return false;
    }

    function translateElement(root) {
        if (getLanguage() !== 'es') return;
        var scope = root && root.nodeType === 1 ? root : document.body;
        if (!scope || scope.closest && scope.closest('[data-i18n-skip]')) return;

        var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function (node) {
            if (isProtectedDataNode(node)) return;
            var translated = translateString(node.nodeValue);
            if (translated !== node.nodeValue) node.nodeValue = translated;
        });

        var elements = [scope].concat(Array.prototype.slice.call(scope.querySelectorAll ? scope.querySelectorAll('[placeholder], [title], [aria-label]') : []));
        elements.forEach(function (element) {
            if (element.closest && element.closest('[data-i18n-skip]')) return;
            ['placeholder', 'title', 'aria-label'].forEach(function (attribute) {
                if (element.hasAttribute && element.hasAttribute(attribute)) {
                    var current = element.getAttribute(attribute);
                    var translated = translateString(current);
                    if (translated !== current) element.setAttribute(attribute, translated);
                }
            });
        });
    }

    function setLanguage(language) {
        var lang = normalizeLanguage(language);
        localStorage.setItem(STORAGE_KEY, lang);
        document.documentElement.lang = lang;
        window.dispatchEvent(new CustomEvent('rx:language-changed', { detail: { language: lang } }));
        window.location.reload();
    }

    function mountSelector() {
        if (document.querySelector('[data-rx-language-selector]')) return;
        var sidebarHeader = document.querySelector('#sidebar .sidebar-header');
        if (!sidebarHeader) return;
        var wrap = document.createElement('div');
        wrap.className = 'rx-language-selector';
        wrap.setAttribute('data-rx-language-selector', '');
        wrap.innerHTML =
            '<label for="rxLanguageSelect" class="visually-hidden">Select Language</label>' +
            '<select id="rxLanguageSelect" class="form-select form-select-sm" aria-label="Select Language">' +
            '<option value="en">English</option><option value="es">Español</option></select>';
        var select = wrap.querySelector('select');
        select.value = getLanguage();
        select.addEventListener('change', function () { setLanguage(select.value); });
        sidebarHeader.appendChild(wrap);
    }

    function boot() {
        var lang = getLanguage();
        document.documentElement.lang = lang;
        mountSelector();
        translateElement(document.body);
        if (lang === 'es') {
            document.title = translateString(document.title);
            var observer = new MutationObserver(function (records) {
                records.forEach(function (record) {
                    if (record.type === 'characterData') {
                        var textNode = record.target;
                        if (!isProtectedDataNode(textNode)) {
                            var translatedText = translateString(textNode.nodeValue);
                            if (translatedText !== textNode.nodeValue) textNode.nodeValue = translatedText;
                        }
                        return;
                    }
                    if (record.type === 'attributes') {
                        var element = record.target;
                        if (!element.closest || !element.closest('[data-i18n-skip]')) {
                            var current = element.getAttribute(record.attributeName);
                            var translatedAttribute = translateString(current);
                            if (translatedAttribute !== current) element.setAttribute(record.attributeName, translatedAttribute);
                        }
                        return;
                    }
                    Array.prototype.forEach.call(record.addedNodes || [], function (node) {
                        if (node.nodeType === 1) translateElement(node);
                        if (node.nodeType === 3 && !isProtectedDataNode(node)) {
                            var translatedNode = translateString(node.nodeValue);
                            if (translatedNode !== node.nodeValue) node.nodeValue = translatedNode;
                        }
                    });
                });
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['placeholder', 'title', 'aria-label']
            });
        }
    }

    window.RXI18n = {
        getLanguage: getLanguage,
        setLanguage: setLanguage,
        translate: translateString,
        translations: EXACT_ES,
        phrases: PHRASE_ES
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
